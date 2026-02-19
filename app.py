import os
import joblib
import pandas as pd
import numpy as np
from flask import Flask, request, jsonify, render_template
from flask_cors import CORS
from sqlalchemy import create_engine
from pathlib import Path
from dotenv import load_dotenv

# ---------------------------------------------------
# 1️⃣ CONFIGURATION
# ---------------------------------------------------

load_dotenv()

app = Flask(__name__)
CORS(app)

DB_URI = os.getenv("DATABASE_URL")

if DB_URI:
    if DB_URI.startswith("postgres://"):
        DB_URI = DB_URI.replace("postgres://", "postgresql://", 1)
else:
    DB_URI = "postgresql://postgres:Swathi%40123@localhost:5432/EcoPackAI"

engine = create_engine(DB_URI)

# ---------------------------------------------------
# 2️⃣ MODEL LOADING
# ---------------------------------------------------

BASE_DIR = Path(__file__).resolve().parent

def load_model(filename):
    path = BASE_DIR / filename
    if not path.exists():
        print(f"⚠ ERROR: {filename} not found at {path}")
        return None
    return joblib.load(path)

rf_model = load_model("rf_model.pkl")
xgb_model = load_model("xgb_model.pkl")
scaler = load_model("scaler.pkl")

# ---------------------------------------------------
# 3️⃣ DATA UTILITIES
# ---------------------------------------------------

def fetch_data():
    query = "SELECT * FROM materials"
    return pd.read_sql(query, engine)

def safe_normalize(value, series):
    min_val = series.min()
    max_val = series.max()
    if max_val == min_val:
        return 0.5
    return (value - min_val) / (max_val - min_val)

# ---------------------------------------------------
# 4️⃣ CATEGORY RULES
# ---------------------------------------------------

Category_rules = {
    "food": lambda df: df[df["biodegradability_score"] >= 8],
    "beverages": lambda df: df[(df["strength"] >= 3) & (df["recyclability"] >= 70)],
    "pharmaceuticals": lambda df: df[df["biodegradability_score"] >= 6],
    "agriculture": lambda df: df[df["biodegradability_score"] >= 9],
    "electronics": lambda df: df[df["strength"] >= 4],
    "automotive_parts": lambda df: df[df["strength"] >= 5],
    "construction_tools": lambda df: df[df["weight_capacity"] >= 50],
    "industrial_chemicals": lambda df: df[(df["strength"] >= 5) & (df["recyclability"] >= 50)],
    "cosmetics": lambda df: df[df["recyclability"] >= 80],
    "apparel_fashion": lambda df: df[df["biodegradability_score"] >= 7],
    "luxury_goods": lambda df: df[df["cost_per_unit"] >= 100],
    "e_commerce_general": lambda df: df[df["recyclability"] >= 60],
    "home_appliances": lambda df: df[df["strength"] >= 4],
    "toys_baby_products": lambda df: df[(df["biodegradability_score"] >= 8) & (df["strength"] >= 2)],
    "office_supplies": lambda df: df[df["recyclability"] >= 90]
}

# ---------------------------------------------------
# 5️⃣ ROUTES
# ---------------------------------------------------

@app.route("/")
def home():
    return render_template("index.html")

@app.route("/health")
def health():
    return jsonify({
        "status": "online",
        "message": "EcoPackAI API is working fine!"
    })

@app.route("/recommend", methods=["POST"])
def recommend():
    try:
        data = request.get_json()
        required_fields = ["product_category", "fragility", "Shipping_Type", "Sustainability_Priority"]

        if not data or not all(field in data for field in required_fields):
            return jsonify({"error": "Missing required fields"}), 400

        full_df = fetch_data()

        if full_df.empty:
            return jsonify({"error": "No materials data available"}), 500

        # ---------------- CATEGORY FILTER (STRICT)
        product_category = data["product_category"].lower()

        if product_category in Category_rules:
            materials_df = Category_rules[product_category](full_df)
        else:
            materials_df = full_df.copy()

        if materials_df.empty:
            return jsonify({"error": "No materials match selected category"}), 400

        # ---------------- FRAGILITY FILTER
        fragility = data.get("fragility", "medium").lower()

        if fragility == "high":
            strength_boost = 0.2
            materials_df = materials_df[materials_df["strength"] >= 4]
        elif fragility == "medium":
            strength_boost = 0.1
            materials_df = materials_df[materials_df["strength"] >= 2]
        else:
            strength_boost = 0.0

        if materials_df.empty:
            return jsonify({"error": "No materials after fragility filter"}), 400

        # ---------------- PRIORITY WEIGHTS
        prio = data["Sustainability_Priority"].lower()

        if prio == "high":
            w_cost, w_co2, w_suit = 0.10, 0.55, 0.35
        elif prio == "medium":
            w_cost, w_co2, w_suit = 0.30, 0.40, 0.30
        else:
            w_cost, w_co2, w_suit = 0.60, 0.25, 0.15

        # ---------------- ML FEATURE PREP
        rename_map = {
            "strength": "Strength",
            "weight_capacity": "Weight_Capacity",
            "cost_per_unit": "Cost_Per_Unit_INR",
            "biodegradability_score": "Biodegradability_Score",
            "recyclability": "Recyclability"
        }

        feature_order = [
            "Strength",
            "Weight_Capacity",
            "Cost_Per_Unit_INR",
            "Biodegradability_Score",
            "Recyclability"
        ]

        X_input = materials_df[list(rename_map.keys())].rename(columns=rename_map)
        X_input = X_input[feature_order]

        # ---------------- ML CO2 PREDICTION
        if scaler and xgb_model:
            X_scaled = scaler.transform(X_input)
            xgb_preds = xgb_model.predict(X_scaled)
        else:
            xgb_preds = materials_df["co2_emission_score"].values

        results = []

        for i, (idx, row) in enumerate(materials_df.iterrows()):

            s_norm = safe_normalize(row["strength"], full_df["strength"])
            r_norm = safe_normalize(row["recyclability"], full_df["recyclability"])
            b_norm = safe_normalize(row["biodegradability_score"], full_df["biodegradability_score"])
            cost_norm = safe_normalize(row["cost_per_unit"], full_df["cost_per_unit"])

            pred_co2 = max(0.0, float(xgb_preds[i]))
            co2_norm = safe_normalize(pred_co2, full_df["co2_emission_score"])

            suitability = (
                (0.4 + strength_boost) * s_norm +
                0.3 * r_norm +
                0.3 * b_norm
            )

            final_score = (
                w_cost * (1 - cost_norm) +
                w_co2 * (1 - co2_norm) +
                w_suit * suitability
            )

            results.append({
                "material": row["material_type"],
                "predicted_cost": round(float(row["cost_per_unit"]), 2),
                "predicted_co2": round(pred_co2, 2),
                "suitability_score": round(final_score * 100, 2)
            })

        df_results = pd.DataFrame(results)
        top5 = df_results.sort_values("suitability_score", ascending=False).head(5)

        return jsonify({
            "recommended_materials": top5.to_dict(orient="records")
        })

    except Exception as e:
        print("Error in /recommend:", e)
        return jsonify({"error": "Internal Server Error", "details": str(e)}), 500


# ---------------------------------------------------
# 6️⃣ RUN
# ---------------------------------------------------

if __name__ == "__main__":
    port = int(os.environ.get("PORT", 5000))
    app.run(host="0.0.0.0", port=port, debug=False)
