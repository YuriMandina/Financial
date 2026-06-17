import re

with open('../frontend/src/App.jsx', 'r', encoding='utf-8') as f:
    content = f.read()

# 1. Imports
if "import { AuthScreen }" not in content:
    content = content.replace("import DateRangePicker from './DateRangePicker';", "import DateRangePicker from './DateRangePicker';\nimport { AuthScreen } from './Auth';\nimport { Settings } from './Settings';")

# 2. Add auth states inside App
auth_states = """  const [token, setToken] = useState(localStorage.getItem('token') || '');

  const fetchWithAuth = async (url, options = {}) => {
    const defaultHeaders = { 'Authorization': `Bearer ${token}` };
    if (options.headers) {
      Object.assign(options.headers, defaultHeaders);
    } else {
      options.headers = defaultHeaders;
    }
    const res = await fetch(url, options);
    if (res.status === 401) {
      setToken('');
      localStorage.removeItem('token');
      throw new Error('Sessão expirada');
    }
    return res;
  };

  if (!token) {
    return <AuthScreen onLogin={setToken} />;
  }
"""

if "const [token, setToken]" not in content:
    content = content.replace("  const [dataInicial, setDataInicial] = useState('');", auth_states + "\n  const [dataInicial, setDataInicial] = useState('');")

# 3. Replace fetch( with fetchWithAuth( inside App
# This regex is careful: we only want to replace fetch() calls that hit our backend.
# Actually, the user's code uses fetch(`http://localhost:8000/...`
content = re.sub(r'fetch\(', r'fetchWithAuth(', content)
# Restore the native fetch inside fetchWithAuth
content = content.replace('const res = await fetchWithAuth(url, options);', 'const res = await fetch(url, options);')

# 4. Add "Configurações" to sidebar
sidebar_button = """
          <button 
            onClick={() => { setMenuAtivo('configuracoes'); setReciboGerado(false); }}
            className={`w-full flex items-center gap-3 px-6 py-4 font-bold transition-all ${menuAtivo === 'configuracoes' ? 'bg-indigo-600/10 text-indigo-400 border-r-4 border-indigo-500' : 'text-slate-400 hover:bg-slate-800/50 hover:text-slate-200'}`}
          >
            <SettingsIcon size={20} /> CONFIGURAÇÕES
          </button>
"""
if "menuAtivo === 'configuracoes'" not in content:
    # Need to import SettingsIcon from lucide-react if not present, but wait, Settings is imported? Let's check imports.
    # We can just use the Settings component icon which we will import as SettingsIcon.
    content = content.replace("import {\n  LayoutDashboard,", "import {\n  Settings as SettingsIcon, LayoutDashboard,")
    
    # Inject before the empty space at the end of nav
    content = content.replace('</nav>', sidebar_button + '</nav>')

# 5. Render Settings in the main content
settings_render = """
        {menuAtivo === 'configuracoes' ? (
          <Settings token={token} />
        ) : (
          <div className="flex-1 p-8 z-10 print:!p-0 print:!m-0 print:!block print:!overflow-visible">
"""
if "<Settings token={token} />" not in content:
    content = content.replace('<div className="flex-1 p-8 z-10 print:!p-0 print:!m-0 print:!block print:!overflow-visible">', settings_render)
    # We must close the parenthesis after the dashboard div.
    # The dashboard div closes right before `</main>`
    content = content.replace('          </div>\n\n      </main>', '          </div>\n        )}\n\n      </main>')
    content = content.replace('          </div>\n      </main>', '          </div>\n        )}\n      </main>')


with open('../frontend/src/App.jsx', 'w', encoding='utf-8') as f:
    f.write(content)

print("Refactored App.jsx successfully!")
