import requests

url = "http://127.0.0.1:5000/recommend"
payload = {
    "product_category": "cosmetics",
    "fragility": "high",
    "Shipping_Type": "air",
    "Sustainability_Priority": "eco"
}

response = requests.post(url, json=payload)

print("Status code:", response.status_code)
print("Response text:", response.text)   # <-- show raw output
