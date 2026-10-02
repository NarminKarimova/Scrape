import requests
from bs4 import BeautifulSoup

# Bugatti ID is 408. Let's try page 50.
url = "https://turbo.az/autos?q%5Bmake%5D%5B%5D=408&page=50"
headers = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36"
}

print(f"Testing connection to: {url}")
try:
    response = requests.get(url, headers=headers, timeout=15, verify=False)
    print(f"Status Code: {response.status_code}")
    
    soup = BeautifulSoup(response.content, 'html.parser')
    products = soup.find_all('div', class_='products-i')
    print(f"Found {len(products)} products on page 50.")
    if products:
        print("First product title:", products[0].find('div', class_='products-i__name').text.strip())
        
    # Check for specific "No results" indicator if possible?
    # Or see if we are getting promoted ads.
    
except Exception as e:
    print(f"Connection failed: {e}")
