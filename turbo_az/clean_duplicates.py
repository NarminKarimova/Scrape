import pandas as pd
from pathlib import Path

# Path to the CSV file
file_path = Path(r"c:\Users\stmehdiyev\Desktop\projects\scrape projects\scrape_turbo_az\data\2026-01\turbo_az_phones_2026-01.csv")

if file_path.exists():
    print(f"Reading file: {file_path}")
    try:
        # Read the CSV
        df = pd.read_csv(file_path)
        original_count = len(df)
        
        # Remove duplicates based on 'url', keeping the first occurrence (or last? usually keep first found or last updated. Let's keep last to get latest info if multiple)
        # However, usually duplicates are exact copies. Let's keep 'first' to be safe, or 'last' if we think newer scrapes are better.
        # Given the append mode, newer entries are at the bottom.
        df_cleaned = df.drop_duplicates(subset=['url'], keep='last')
        cleaned_count = len(df_cleaned)
        
        duplicates_removed = original_count - cleaned_count
        
        if duplicates_removed > 0:
            # Save the cleaned CSV
            df_cleaned.to_csv(file_path, index=False, encoding='utf-8')
            print(f"✅ Removed {duplicates_removed} duplicates.")
            print(f"Original count: {original_count}")
            print(f"Cleaned count: {cleaned_count}")
        else:
            print("✅ No duplicates found.")
            
    except Exception as e:
        print(f"❌ Error cleaning CSV: {e}")
else:
    print(f"❌ File not found: {file_path}")
