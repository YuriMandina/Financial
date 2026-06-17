import re

with open('main.py', 'r', encoding='utf-8') as f:
    content = f.read()

# 1. Add contextvars and auth imports
imports_to_add = """import contextvars
from fastapi import Depends, HTTPException
import auth
from api_auth import router as auth_router
from api_invites import router as invites_router
from api_settings import router as settings_router
import models
"""
content = re.sub(r'(from fastapi import FastAPI)', imports_to_add + r'\n\1', content)

# 2. Add routers to app
router_includes = """
app.include_router(auth_router)
app.include_router(invites_router)
app.include_router(settings_router)

current_org = contextvars.ContextVar("current_org")
"""
content = re.sub(r'(from models import SyncSnapshot)', r'\1\n' + router_includes, content)

# 3. Modify APP_KEY and APP_SECRET parsing to use contextvars
# First, remove old APP_KEY globals
content = re.sub(r'APP_KEY = os\.getenv\("OMIE_APP_KEY"\)\nAPP_SECRET = os\.getenv\("OMIE_APP_SECRET"\)\n', '', content)

# In any _omie function that constructs payload, replace APP_KEY/APP_SECRET
content = re.sub(r'"app_key": APP_KEY,', r'"app_key": current_org.get().omie_app_key,', content)
content = re.sub(r'"app_secret": APP_SECRET,', r'"app_secret": current_org.get().omie_app_secret,', content)

# 4. Modify obter_global_db to use current_org for saving and querying
old_query = r'snap = db\.query\(SyncSnapshot\)\.filter\(SyncSnapshot\.cache_key == cache_key\)\.first\(\)'
new_query = r'org = current_org.get()\n        snap = db.query(SyncSnapshot).filter(SyncSnapshot.cache_key == cache_key, SyncSnapshot.organization_id == org.id).first()'
content = content.replace(old_query, new_query)

old_save = r'tipo_relatorio=tipo_relatorio,\n                data_referencia=data_ref,\n                dados=dados\n            \)'
new_save = r'tipo_relatorio=tipo_relatorio,\n                data_referencia=data_ref,\n                dados=dados,\n                organization_id=org.id\n            )'
content = content.replace(old_save, new_save)

# 5. Modify obter_fatiado_db to use current_org
old_fatiado_query = r'snaps_existentes = db\.query\(SyncSnapshot\)\.filter\(\n                SyncSnapshot\.cache_key\.in_\(cache_keys_buscadas\)\n            \)\.all\(\)'
new_fatiado_query = r'org = current_org.get()\n            snaps_existentes = db.query(SyncSnapshot).filter(\n                SyncSnapshot.cache_key.in_(cache_keys_buscadas),\n                SyncSnapshot.organization_id == org.id\n            ).all()'
content = content.replace(old_fatiado_query, new_fatiado_query)

old_fatiado_save = r'data_referencia=data_str,\n                        dados=dados_dia\n                    \)'
new_fatiado_save = r'data_referencia=data_str,\n                        dados=dados_dia,\n                        organization_id=org.id\n                    )'
content = content.replace(old_fatiado_save, new_fatiado_save)

# 6. Delete snapshot endpoint must be protected
content = re.sub(r'def deletar_snapshot\(id: int\):', r'def deletar_snapshot(id: int, current_user: models.User = Depends(auth.get_current_user)):', content)

# Protect delete endpoint body
content = re.sub(r'snap = db\.query\(SyncSnapshot\)\.filter\(SyncSnapshot\.id == id\)\.first\(\)', r'snap = db.query(SyncSnapshot).filter(SyncSnapshot.id == id, SyncSnapshot.organization_id == current_user.organization_id).first()', content)

# 7. Protect /api/snapshots endpoint
content = re.sub(r'def listar_snapshots\(\):', r'def listar_snapshots(current_user: models.User = Depends(auth.get_current_user)):', content)
content = re.sub(r'snaps = db\.query\(SyncSnapshot\)\.order_by\(SyncSnapshot\.id\.desc\(\)\)\.all\(\)', r'snaps = db.query(SyncSnapshot).filter(SyncSnapshot.organization_id == current_user.organization_id).order_by(SyncSnapshot.id.desc()).all()', content)

# 8. Protect all GET /api/relatorios/* endpoints
# We need to find all @app.get("/api/relatorios/...") and inject Depends and current_org
import re
def replace_endpoint(match):
    decorator = match.group(1)
    func_def = match.group(2)
    # inject current_user to args
    if "(" in func_def and "):" in func_def:
        if func_def.endswith("():"):
            new_func_def = func_def.replace("():", "(current_user: models.User = Depends(auth.get_current_user)):")
        else:
            new_func_def = func_def.replace("):", ", current_user: models.User = Depends(auth.get_current_user)):")
    else:
        new_func_def = func_def
        
    injection = "\n    current_org.set(current_user.organization)\n"
    # We must also check if omie keys are set, else return 400
    injection += """    if not current_user.organization.omie_app_key or not current_user.organization.omie_app_secret:
        return JSONResponse(status_code=400, content={"error": "Chaves da Omie não configuradas. Vá em Configurações para configurá-las."})
"""
    return decorator + "\n" + new_func_def + injection

content = re.sub(r'(@app\.get\("/api/relatorios/[^\n]+\)\n)([^\n]+def [^\n]+\n)', replace_endpoint, content)

with open('main.py', 'w', encoding='utf-8') as f:
    f.write(content)

print("Refactored main.py successfully!")
