import pandas as pd

def tratar_vazio(valor):
    if pd.isna(valor) or str(valor).strip().lower() in ["", "nan", "none", "nat"]:
        return "-"
    return str(valor)

def safe_float(valor):
    try:
        if valor is None or str(valor).strip() == "":
            return 0.0
        return float(valor)
    except (ValueError, TypeError):
        return 0.0
