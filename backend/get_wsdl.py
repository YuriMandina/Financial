import urllib.request
try:
    xml = urllib.request.urlopen('https://app.omie.com.br/api/v1/estoque/ajuste/?WSDL').read().decode('utf-8')
    with open('wsdl.xml', 'w') as f:
        f.write(xml)
    print("Saved to wsdl.xml")
except Exception as e:
    print("Error:", e)
