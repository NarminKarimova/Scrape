#!/usr/bin/env python3
"""
Turbo.az Phone Number Scraper - Extracts phone numbers from car listings
Saves phone numbers and listing details to CSV organized by month
Uses fast HTML parsing (no browser automation needed)
"""

import requests
from bs4 import BeautifulSoup
import pandas as pd
import time
import re
import json
import random
from datetime import datetime, timedelta
from pathlib import Path
from tqdm import tqdm
from brands_list import TURBO_AZ_BRANDS
import urllib3
import sys

urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)


class TurboAzPhoneScraper:
    """Scraper for turbo.az that extracts phone numbers from listings"""
    
    def __init__(self):
        self.base_url = "https://turbo.az"
        self.headers = {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36"
        }
    
    def extract_phone_numbers(self, url: str) -> tuple:
        """Extract phone numbers and owner name from a listing page"""
        phone_numbers = []
        owner_name = "N/A"
        try:
            response = requests.get(url, headers=self.headers, verify=False, timeout=10)
            if response.status_code != 200:
                return phone_numbers, owner_name
            
            soup = BeautifulSoup(response.content, 'html.parser')
            
            # Method 1: Extract from data-receiver attribute in chat-write-link
            # This is the most reliable method as it contains the raw phone data
            chat_link = soup.find(id='chat-write-link')
            if chat_link:
                data_receiver = chat_link.get('data-receiver')
                if data_receiver:
                    try:
                        receiver_data = json.loads(data_receiver)
                        # Extract owner name
                        if 'name' in receiver_data:
                            owner_name = receiver_data['name']
                            
                        phones = receiver_data.get('phones', [])
                        for phone in phones:
                            clean_phone = re.sub(r'[\s\-\(\)]', '', phone)
                            if self._is_valid_phone(clean_phone) and clean_phone not in phone_numbers:
                                phone_numbers.append(clean_phone)
                    except json.JSONDecodeError:
                        pass
            
            # Method 2: Look for tel: links (backup)
            if not phone_numbers:
                phone_links = soup.find_all('a', href=re.compile(r'tel:', re.IGNORECASE))
                for link in phone_links:
                    href = link.get('href', '')
                    phone_match = re.search(r'[\+\d][\d\s\-\(\)]{8,}', href)
                    if phone_match:
                        phone = re.sub(r'[\s\-\(\)]', '', phone_match.group(0))
                        if phone not in phone_numbers and self._is_valid_phone(phone):
                            phone_numbers.append(phone)
            
            # Method 3: Regex generic search (last resort)
            if not phone_numbers:
                page_text = soup.get_text()
                phone_matches = re.findall(r'(?:\+\d{1,3})?[\s\-]?\d[\d\s\-\(\)]{8,}', page_text)
                for phone_match in phone_matches:
                    phone = re.sub(r'[\s\-\(\)]', '', phone_match)
                    if phone not in phone_numbers and self._is_valid_phone(phone):
                        phone_numbers.append(phone)
            
        except Exception:
            pass
        
        return list(set(phone_numbers)), owner_name
    
    def _is_valid_phone(self, phone: str) -> bool:
        """Validate phone number format"""
        # Remove any remaining non-digit characters except +
        cleaned = re.sub(r'[^\d\+]', '', phone)
        
        # Should be at least 10 digits (Azerbaijan +994XX XXXXXXX or 0XX XXXXXXX)
        digits_only = re.sub(r'\D', '', cleaned)
        
        if len(digits_only) < 10:
            return False
        
        # Check if it looks like a valid phone (doesn't have too many repeating digits)
        if len(set(digits_only)) == 1:
            return False
        
        return True
    
    def scrape_phone_numbers_by_brand(self, brands=None, output_file=None):
        """Scrape phone numbers from listings by brand"""
        if brands is None:
            brands = TURBO_AZ_BRANDS
            
        # Checkpoint logic
        processed_brands = set()
        seen_urls = set()
        
        # Load existing URLs to prevent duplicates
        if output_file and output_file.exists():
            try:
                # Read checking for 'brand' and 'url'
                df_existing = pd.read_csv(output_file, usecols=['brand', 'url'])
                processed_brands = set(df_existing['brand'].unique())
                seen_urls = set(df_existing['url'].unique())
                print(f"Resume: Found {len(processed_brands)} brands and {len(seen_urls)} listings already in {output_file.name}")
            except Exception:
                print("Warning: Could not read existing file for resuming. Starting fresh or appending.")
        
        all_data = [] # Only for returning summary, though we save incrementally
        
        # Filter brands to process
        # User requested link-by-link checking, so we usually shouldn't skip entire brands
        # unless we are sure they are complete. But for efficiency, if we have a robust stop mechanism
        # we can process all. 
        # listing_pbar will handle skipping individual URLs.
        brands_to_process = brands
        
        if not brands_to_process:
            print("No brands to process!")
            return []
            
        pbar = tqdm(brands_to_process, desc="Brands")
        for brand in pbar:
            brand_name = brand.get('name', 'Unknown')
            brand_id = brand.get('id')
            pbar.set_description(f"Brand: {brand_name}")
            
            # Per-brand data for immediate saving
            brand_data = []
            
            url = f"https://turbo.az/autos?q%5Bmake%5D%5B%5D={brand_id}"
            page = 1
            max_retries = 3
            consecutive_failures = 0
            
            while True:
                page_url = f"{url}&page={page}" if page > 1 else url
                # Optional: display page progress in description or logs
                # pbar.set_description(f"Brand: {brand_name} (Page {page})")
                
                try:
                    response = requests.get(page_url, headers=self.headers, timeout=15, verify=False)
                    
                    if response.status_code in [429, 500, 502, 503, 504]:
                        consecutive_failures += 1
                        wait_time = 30 * consecutive_failures
                        print(f"\n⚠️ Status {response.status_code} for brand {brand_name} (Page {page}). Cooling down for {wait_time}s...")
                        time.sleep(wait_time)
                        if consecutive_failures >= max_retries:
                             print(f"Skipping brand {brand_name} after {max_retries} failed page requests (Status {response.status_code})")
                             break
                        continue
                    
                    response.raise_for_status()
                    consecutive_failures = 0  # Reset failures on success
                    
                    soup = BeautifulSoup(response.content, 'html.parser')
                    
                    listings = self._parse_listings(soup)
                    if not listings:
                        break
                    
                    # Stop if we see "Similar ads" block ONLY or if we are just finding "VIP" ads that are irrelevant
                    # Turbo.az always shows "Similar ads" on empty pages. 
                    # We can detect this by checking if the extracted listings match the requested brand.
                    # Or simpler: if ALL listings on this page are duplicates of what we've seen, STOP.
                    
                    valid_new_listings = 0
                    listing_pbar = tqdm(listings, desc=f"  Page {page}", leave=False, unit="ad")
                    
                    for listing in listing_pbar:
                        listing_url = listing.get('url')
                        
                        # Skip if already seen
                        if listing_url in seen_urls or listing_url == 'N/A':
                            continue
                        
                        # Sanity check: if brand is totally different, might be "Similar ads" section
                        # But some titles are messy. 
                        # Best check: If we have seen ALL urls on this page before, it's an infinite loop of sticky ads.
                        
                        seen_urls.add(listing_url)
                        valid_new_listings += 1
                        
                        # Extract phone numbers using requests with retry/catch
                        try:
                            # Add random delay between requests to avoid rate limits
                            time.sleep(random.uniform(0.5, 1.5))
                            
                            if listing_url.startswith('http'):
                                phones, owner_name = self.extract_phone_numbers(listing_url)
                                listing['phone_numbers'] = ', '.join(phones) if phones else 'N/A'
                                listing['phone_count'] = len(phones)
                                listing['owner'] = owner_name
                            else:
                                listing['phone_numbers'] = 'N/A'
                                listing['phone_count'] = 0
                                listing['owner'] = 'N/A'
                            
                            brand_data.append(listing)
                            all_data.append(listing)
                        except Exception:
                            # Skip this listing if it fails
                            continue
                    
                    listing_pbar.close()
                    
                    # Anti-infinite loop check & Optimization (Stop if caught up)
                    if valid_new_listings == 0:
                        # If we found listings but NONE of them were new, it means:
                        # 1. We consistently found "Similar ads" (junk).
                        # 2. OR We have reached a point where we have already scraped all these listings (Resuming).
                        
                        if len(listings) > 0:
                             # Only print this if we are deep in pages or if it's significant
                             if page > 1:
                                 # Standard stop for similar ads or caught up
                                 pass 
                             else:
                                 # Page 1 full of duplicates - brand likely already done
                                 pass
                                 
                             # print(f"  Stopping brand {brand_name} at page {page} (No new listings found)")
                             break

                    time.sleep(random.uniform(1.0, 2.0))
                    page += 1
                    
                except requests.exceptions.RequestException as e:
                    consecutive_failures += 1
                    err_msg = str(e)
                    print(f"\n❌ Request failed: {err_msg}")
                    if consecutive_failures >= max_retries:
                        print(f"Skipping brand {brand_name} after {max_retries} failed page requests")
                        break
                    time.sleep(5)
                    continue
                except Exception as e:
                    # Generic error for page
                    print(f"\n❌ Unexpected error: {e}")
                    break
            
            # Save progress after each brand
            if output_file and brand_data:
                df_brand = pd.DataFrame(brand_data)
                header = not output_file.exists()
                df_brand.to_csv(output_file, mode='a', header=header, index=False, encoding='utf-8')
        
        pbar.close()
        return all_data

    
    def _parse_listings(self, soup: BeautifulSoup) -> list:
        """Parse listings from HTML"""
        listings = []
        products = soup.find_all('div', class_='products-i')
        
        for product in products:
            try:
                listing = {}
                
                # URL and title
                title_link = product.find('a', class_='products-i__link')
                if title_link:
                    href = title_link.get('href', '')
                    listing['url'] = self.base_url + href if href else 'N/A'
                else:
                    listing['url'] = 'N/A'
                
                # Title
                name_elem = product.find('div', class_='products-i__name')
                listing['title'] = name_elem.text.strip() if name_elem else 'N/A'
                
                # Parse brand/model from title
                parts = listing['title'].split()
                listing['brand'] = parts[0] if len(parts) > 0 else 'N/A'
                listing['model'] = ' '.join(parts[1:]) if len(parts) > 1 else 'N/A'
                
                # Price
                price_elem = product.find('div', class_='products-i__price')
                listing['price'] = price_elem.text.strip() if price_elem else 'N/A'
                
                # Year, engine, mileage from attributes
                attrs_elem = product.find('div', class_='products-i__attributes')
                if attrs_elem:
                    attrs_text = attrs_elem.text.strip()
                    parts = [p.strip() for p in attrs_text.split(',')]
                    listing['year'] = parts[0] if len(parts) > 0 else 'N/A'
                    listing['engine'] = parts[1] if len(parts) > 1 else 'N/A'
                    listing['mileage'] = parts[2] if len(parts) > 2 else 'N/A'
                
                # Location and date
                dt_elem = product.find('div', class_='products-i__datetime')
                if dt_elem:
                    dt_text = dt_elem.text.strip()
                    if ',' in dt_text:
                        loc, date_part = dt_text.split(',', 1)
                        listing['location'] = loc.strip()
                        listing['datetime'] = date_part.strip()
                        listing['date'], listing['time'] = self._parse_date(date_part.strip())
                    else:
                        listing['location'] = 'N/A'
                        listing['datetime'] = 'N/A'
                        listing['date'] = 'N/A'
                        listing['time'] = 'N/A'
                
                listing['scraped_at'] = datetime.now().isoformat()
                listings.append(listing)
                
            except Exception:
                continue
        
        return listings
    
    def _parse_date(self, date_str: str) -> tuple:
        """Parse Azerbaijani date to ISO and extract time"""
        today = datetime.now().date()
        time_match = re.search(r'(\d{2}):(\d{2})', date_str)
        time_str = time_match.group(0) if time_match else 'N/A'
        
        if 'bugün' in date_str.lower():
            target_date = today
        elif 'dünən' in date_str.lower():
            target_date = today - timedelta(days=1)
        else:
            match = re.search(r'(\d+)\s*gün', date_str.lower())
            days_ago = int(match.group(1)) if match else 0
            target_date = today - timedelta(days=days_ago)
        
        return target_date.isoformat(), time_str


def main():
    """Main entry point"""
    test_mode = '--test' in sys.argv

    now = datetime.now()
    run_label = "q2" if now.day > 15 else "q1"

    # Optional override: --run-label q1|q2
    if '--run-label' in sys.argv:
        try:
            idx = sys.argv.index('--run-label')
            candidate = sys.argv[idx + 1].lower().strip()
            if candidate in {'q1', 'q2'}:
                run_label = candidate
            else:
                print("⚠️ Invalid --run-label value. Using automatic q1/q2.")
        except IndexError:
            print("⚠️ Missing --run-label value. Using automatic q1/q2.")

    print(f"Selected run label: {run_label} (day {now.day})")

    # Create monthly folder
    month_str = now.strftime('%Y-%m')
    period_str = f"{month_str}-{run_label}"
    data_dir = Path(f'data/{period_str}')
    data_dir.mkdir(parents=True, exist_ok=True)

    print(f"\n{'=' * 80}")
    print(f"TURBO.AZ PHONE NUMBER SCRAPER - {period_str}".center(80))
    print(f"{'=' * 80}\n")

    # Scrape
    scraper = TurboAzPhoneScraper()

    if test_mode:
        print("✅ TEST MODE: Scraping first 2 brands only\n")
        brands = TURBO_AZ_BRANDS[:2]
    else:
        print(f"✅ FULL MODE: Scraping all {len(TURBO_AZ_BRANDS)} brands\n")
        brands = TURBO_AZ_BRANDS

    # Define output file path early
    test_suffix = '_test' if test_mode else ''
    csv_file = data_dir / f'turbo_az_phones_{period_str}{test_suffix}.csv'

    # Pass output file to store incrementally
    listings = scraper.scrape_phone_numbers_by_brand(brands, output_file=csv_file)

    if listings:
        # Statistics from memory (only for the current run)
        df_run = pd.DataFrame(listings)
        with_phones = len(df_run[df_run['phone_count'] > 0])
        total_phones = df_run['phone_count'].sum()

        print(f"\n{'=' * 80}")
        print("✅ RUN COMPLETE!")
        print(f"   Listings scraped this run: {len(listings):,}")
        print(f"   Listings with phones: {with_phones:,} ({100*with_phones/len(listings):.1f}%)")
        print(f"   Total phone numbers found: {int(total_phones):,}")
    else:
        print("\n✅ RUN COMPLETE! No new listings scraped.")

    # Final stats from file
    if csv_file.exists():
        df_total = pd.read_csv(csv_file)
        print(f"\n   Total in file: {len(df_total):,}")
        print(f"   File: {csv_file}")
        print(f"   Size: {csv_file.stat().st_size / 1024 / 1024:.1f} MB")
        print(f"{'=' * 80}\n")

        # Show columns
        print("Columns:")
        for i, col in enumerate(df_total.columns, 1):
            print(f"  {i:2d}. {col}")


if __name__ == '__main__':
    main()
