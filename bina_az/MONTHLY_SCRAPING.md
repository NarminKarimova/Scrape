# Monthly Scraping Guide

## Quick Start - Run Every Month

Simply run this command to scrape all new data:

```powershell
python scrape_monthly.py
```

This will:

- ✓ Scrape all sale properties
- ✓ Scrape all rent properties  
- ✓ Save as `bina_sale_202604-q1.csv`, `bina_rent_202604-q1.csv` (first half) or `...-q2...` (second half)
- ✓ Also save as `.xlsx` for Excel
- ✓ Remove old `checkpoint.json` files before scraping

## File Naming Convention

Files are saved with format: `{type}_{YYYYMM-qX}.{format}`

Rule:
- If day is before 15th, use `q1`
- Otherwise use `q2`

Examples:
- **April 10, 2026**: `bina_sale_202604-q1.csv`, `bina_rent_202604-q1.csv`
- **April 20, 2026**: `bina_sale_202604-q2.csv`, `bina_rent_202604-q2.csv`
- **January 7, 2025**: `bina_sale_202501-q1.csv`, `bina_rent_202501-q1.csv`

## Comparison Workflow

### Step 1: Scrape old data (if not done yet)
```powershell
python scrape_monthly.py
```
This creates: `bina_sale_202512-q2.csv`, `bina_rent_202512-q2.csv` (second run in December 2025)

### Step 2: Wait a month, then scrape again
```powershell
python scrape_monthly.py
```
This creates: `bina_sale_202601-q1.csv`, `bina_rent_202601-q1.csv` (first run in January 2026)

### Step 3: Compare old vs new data
Use the comparison script (you can request this to be created):
```powershell
python compare_months.py --month1 202512-q2 --month2 202601-q1
```

## File Locations

All data files are saved in: `./data/`

View saved files:
```powershell
dir ./data/ -Filter "bina_*"
```

## Troubleshooting

If dependencies are missing, install them once:
```powershell
pip install -r requirements.txt
```

## Notes

- First run will take several hours (thousands of properties)
- Subsequent months are faster as they're incremental
- All files auto-save with timestamps for tracking
- Progress is logged to console
