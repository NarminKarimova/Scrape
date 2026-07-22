import { GetObjectCommand, ListObjectsV2Command, S3Client } from "@aws-sdk/client-s3";
import { promises as fs } from "node:fs";
import path from "node:path";
import { getCloudflareContext } from "@opennextjs/cloudflare";

export interface DataBackend {
  readonly id: string;
  listParquetPaths(subdir: string): Promise<string[]>;
  readFileBuffer(relativePath: string): Promise<ArrayBuffer>;
}

function normalizeRelativePath(relativePath: string): string {
  return relativePath.replace(/\\/g, "/").replace(/^\/+/, "");
}

async function dirExists(dir: string): Promise<boolean> {
  try {
    const stat = await fs.stat(dir);
    return stat.isDirectory();
  } catch {
    return false;
  }
}

async function walkParquetFiles(dir: string): Promise<string[]> {
  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT") return [];
    throw error;
  }

  const files = await Promise.all(
    entries.map(async (entry) => {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) return walkParquetFiles(fullPath);
      if (entry.isFile() && entry.name.toLowerCase().endsWith(".parquet")) return [fullPath];
      return [];
    }),
  );

  return files.flat();
}

function createFsBackend(dataRoot: string, id: string): DataBackend {
  return {
    id,
    async listParquetPaths(subdir: string) {
      const absoluteFiles = await walkParquetFiles(path.join(dataRoot, subdir));
      return absoluteFiles
        .map((filePath) => path.relative(dataRoot, filePath).replace(/\\/g, "/"))
        .sort((a, b) => a.localeCompare(b));
    },
    async readFileBuffer(relativePath: string) {
      const normalized = normalizeRelativePath(relativePath);
      const filePath = path.resolve(dataRoot, normalized);
      const rootWithSeparator = dataRoot.endsWith(path.sep) ? dataRoot : `${dataRoot}${path.sep}`;
      if (!filePath.toLowerCase().startsWith(rootWithSeparator.toLowerCase())) {
        throw new Error(`Refusing to read file outside data directory: ${relativePath}`);
      }
      const buffer = await fs.readFile(filePath);
      return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) as ArrayBuffer;
    },
  };
}

function createR2BindingBackend(bucket: R2Bucket): DataBackend {
  return {
    id: "r2-binding",
    async listParquetPaths(subdir: string) {
      const prefix = `${normalizeRelativePath(subdir).replace(/\/?$/, "")}/`;
      const keys: string[] = [];
      let cursor: string | undefined;

      do {
        const page = await bucket.list({ prefix, cursor });
        for (const object of page.objects) {
          if (object.key.toLowerCase().endsWith(".parquet")) {
            keys.push(object.key);
          }
        }
        cursor = page.truncated ? page.cursor : undefined;
      } while (cursor);

      return keys.sort((a, b) => a.localeCompare(b));
    },
    async readFileBuffer(relativePath: string) {
      const key = normalizeRelativePath(relativePath);
      const object = await bucket.get(key);
      if (!object) {
        throw new Error(`Object not found in R2: ${key}`);
      }
      return object.arrayBuffer();
    },
  };
}

function createS3R2Backend(
  client: S3Client,
  bucketName: string,
): DataBackend {
  return {
    id: "r2-s3",
    async listParquetPaths(subdir: string) {
      const prefix = `${normalizeRelativePath(subdir).replace(/\/?$/, "")}/`;
      const keys: string[] = [];
      let continuationToken: string | undefined;

      do {
        const response = await client.send(
          new ListObjectsV2Command({
            Bucket: bucketName,
            Prefix: prefix,
            ContinuationToken: continuationToken,
          }),
        );
        for (const object of response.Contents ?? []) {
          if (object.Key?.toLowerCase().endsWith(".parquet")) {
            keys.push(object.Key);
          }
        }
        continuationToken = response.IsTruncated ? response.NextContinuationToken : undefined;
      } while (continuationToken);

      return keys.sort((a, b) => a.localeCompare(b));
    },
    async readFileBuffer(relativePath: string) {
      const key = normalizeRelativePath(relativePath);
      const response = await client.send(
        new GetObjectCommand({
          Bucket: bucketName,
          Key: key,
        }),
      );
      if (!response.Body) {
        throw new Error(`Object not found in R2: ${key}`);
      }
      const bytes = await response.Body.transformToByteArray();
      return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
    },
  };
}

function tryS3R2Backend(): DataBackend | null {
  const accountId = process.env.R2_ACCOUNT_ID;
  const accessKeyId = process.env.R2_ACCESS_KEY_ID;
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;
  const bucketName = process.env.R2_BUCKET_NAME ?? "scrape";

  if (!accountId || !accessKeyId || !secretAccessKey) {
    return null;
  }

  const client = new S3Client({
    region: "auto",
    endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId, secretAccessKey },
  });

  return createS3R2Backend(client, bucketName);
}

async function tryFsBackend(rootName: string, id: string): Promise<DataBackend | null> {
  const dataRoot = path.resolve(process.cwd(), rootName);
  if (!(await dirExists(dataRoot))) return null;
  return createFsBackend(dataRoot, id);
}

export async function resolveParquetBackend(): Promise<DataBackend> {
  const parquetFs = await tryFsBackend("data", "parquet-fs");
  if (!parquetFs) {
    throw new Error("Parquet data directory not found at data/");
  }
  return parquetFs;
}

export async function resolveDataBackend(): Promise<DataBackend> {
  const processedFs = await tryFsBackend("processed", "processed-fs");
  if (processedFs) return processedFs;

  const parquetFs = await tryFsBackend("data", "parquet-fs");
  if (parquetFs) return parquetFs;

  const s3Backend = tryS3R2Backend();
  if (s3Backend) return s3Backend;

  try {
    const { env } = await getCloudflareContext({ async: true });
    if (env.DASHBOARD_DATA) {
      return createR2BindingBackend(env.DASHBOARD_DATA);
    }
  } catch {
    // Not running on Cloudflare Workers.
  }

  throw new Error(
    "Dashboard data not found. Set R2 env vars, run npm run upload-data, or add a local data/ directory.",
  );
}

export async function readJsonFile<T>(backend: DataBackend, relativePath: string): Promise<T | null> {
  try {
    const buffer = await backend.readFileBuffer(relativePath);
    const text = new TextDecoder().decode(buffer);
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}
