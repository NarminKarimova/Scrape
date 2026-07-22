declare module "parquetjs-lite" {
  export class ParquetReader {
    static openFile(filePath: string): Promise<ParquetReader>;
    getCursor(): {
      next(): Promise<Record<string, unknown> | null>;
    };
    close(): Promise<void>;
  }
}
