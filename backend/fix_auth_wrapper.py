import re
with open('../frontend/src/App.jsx', 'r', encoding='utf-8') as f:
    content = f.read()

main_return_pattern = r'  return \(\n    <div className=\"flex h-screen bg-slate-950 font-sans overflow-hidden print:!block print:bg-white print:text-slate-900 print:!h-auto print:!overflow-visible\">'

new_return = '''  return (
    <>
      {!token ? (
        <AuthScreen onLogin={setToken} />
      ) : (
        <div className="flex h-screen bg-slate-950 font-sans overflow-hidden print:!block print:bg-white print:text-slate-900 print:!h-auto print:!overflow-visible">'''

content = re.sub(main_return_pattern, new_return, content)

open('../frontend/src/App.jsx', 'w', encoding='utf-8').write(content)
