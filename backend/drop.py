import sys
sys.path.append('.')
from database import engine
from models import Base
from sqlalchemy import text

with engine.connect() as conn:
    conn.execute(text('DROP TABLE IF EXISTS boning_process_items CASCADE;'))
    conn.execute(text('DROP TABLE IF EXISTS boning_processes CASCADE;'))
    conn.execute(text('DROP TABLE IF EXISTS boning_template_items CASCADE;'))
    conn.execute(text('DROP TABLE IF EXISTS boning_templates CASCADE;'))
    conn.execute(text('DROP TABLE IF EXISTS boning_products CASCADE;'))
    conn.execute(text('DROP TABLE IF EXISTS boning_families CASCADE;'))
    conn.commit()

Base.metadata.create_all(bind=engine)
print("Tabelas recriadas com sucesso")
