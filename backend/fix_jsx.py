with open('../frontend/src/App.jsx', 'r', encoding='utf-8') as f:
    content = f.read()

content = content.replace(
    ') : (\n          <div className="flex-1 p-8',
    ') : (\n          <>\n          <div className="flex-1 p-8'
)

content = content.replace(
    '  )}\n      </main>',
    '  </>\n        )}\n      </main>'
)

with open('../frontend/src/App.jsx', 'w', encoding='utf-8') as f:
    f.write(content)
