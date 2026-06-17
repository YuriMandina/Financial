with open('../frontend/src/App.jsx', 'r', encoding='utf-8') as f:
    content = f.read()

# 1. Remove early return
content = content.replace('  if (!token) {\n    return <AuthScreen onLogin={setToken} />;\n  }\n', '')

# 2. Find the main return
main_return = '  return (\n    <div className="flex h-screen bg-slate-950 font-sans antialiased text-slate-200 selection:bg-indigo-500/30 overflow-hidden relative">'

new_return = '''  return (
    <>
      {!token ? (
        <AuthScreen onLogin={setToken} />
      ) : (
        <div className="flex h-screen bg-slate-950 font-sans antialiased text-slate-200 selection:bg-indigo-500/30 overflow-hidden relative">'''

content = content.replace(main_return, new_return)

# 3. Add closing bracket at the very end
content = content.replace('export default App;', '      )}\n    </>\n  );\n}\n\nexport default App;')
# Wait, I might end up with extra closing braces for App.
# `App.jsx` originally ended with:
#   );
# }
# export default App;

# I will just replace `  );\n}\n\nexport default App;` with `        )}\n    </>\n  );\n}\n\nexport default App;`
content = content.replace('  );\n}\n\nexport default App;', '        )}\n    </>\n  );\n}\n\nexport default App;')

with open('../frontend/src/App.jsx', 'w', encoding='utf-8') as f:
    f.write(content)
