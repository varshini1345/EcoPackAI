import os
import joblib
import pandas as pd
import numpy as np
from flask import Flask, request, jsonify
from flask_cors import CORS
from sqlalchemy import create_engine
from pathlib import Path
from dotenv import load_dotenv

# --- 1. CONFIGURATION & SECURITY ---
load_dotenv() 
app = Flask(__name__)
CORS(app)  # Allows your Frontend to talk to this Backend

# Get DB URL from Environment Variable (Render/Heroku)
DB_URI = os.getenv("DATABASE_URL")

if not DB_URI:
    # Local fallback for your machine (Development only)
    DB_URI = "postgresql://postgres:Swathi%40123@localhost:5432/EcoPackAI"
else:
    # Production Fix: SQLAlchemy 1.4+ requires 'postgresql://' instead of 'postgres://'
    if DB_URI.startswith("postgres://"):
        DB_URI = DB_URI.replace("postgres://", "postgresql://", 1)

# Create Database Connection
try:
    engine = create_engine(DB_URI)
except Exception as e:
    print(f"Database Connection Error: {e}")

# DYNAMIC FILE PATHS (Ensures it works on Windows and Linux/Render)
BASE_DIR = Path(__file__).resolve().parent

def load_model(filename):
    path = BASE_DIR / filename
    if not path.exists():
        print(f"CRITICAL ERROR: {filename} not found at {path}")
        return None
    return joblib.load(path)

rf_model = load_model('rf_model.pkl')
xgb_model = load_model('xgb_model.pkl')
scaler = load_model('scaler.pkl')

# --- 2. DATA FETCHING & CATEGORY RULES ---
def fetch_data():
    query = "SELECT * FROM materials"
    return pd.read_sql(query, engine)

def safe_normalize(value, series):
    min_val, max_val = series.min(), series.max()
    if max_val == min_val:
        return 1.0
    return (value - min_val) / (max_val - min_val)

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

# --- 3. ROUTES ---
@app.route("/", methods=['GET'])
def health_check():
    return jsonify({
        "message": "EcoPackAI API is working fine!", 
        "status": "online",
        "database_connected": DB_URI is not None
    })

@app.route("/recommend", methods=['POST'])
def recommend():
    try:
        data = request.get_json()
        required_fields = ["product_category", "fragility", "Shipping_Type", "Sustainability_Priority"]
        
        if not data or not all(field in data for field in required_fields):
            return jsonify({"error": "Missing required fields"}), 400

        # Load data from DB
        materials_df = fetch_data()
        if materials_df.empty:
            return jsonify({"error": "No materials data available in database"}), 500

        # Filtering Logic
        product_category = data["product_category"]
        if product_category in Category_rules:
            filtered_df = Category_rules[product_category](materials_df)
            # Fallback if category filter is too strict
            materials_df = filtered_df if not filtered_df.empty else materials_df
        
        # Fragility Logic
        fragility = data.get("fragility", "medium").lower()
        if fragility == "high":
            materials_df = materials_df[materials_df["strength"] >= 3]
        elif fragility == "medium":
            materials_df = materials_df[materials_df["strength"] >= 2]

        # Dynamic Weighting
        prio = data["Sustainability_Priority"].lower()
        if prio == "high":
            w_cost, w_co2, w_suit = 0.20, 0.40, 0.40
        elif prio == "medium":
            w_cost, w_co2, w_suit = 0.30, 0.35, 0.35
        else:
            w_cost, w_co2, w_suit = 0.40, 0.30, 0.30

        # --- FEATURE MAPPING FOR ML MODEL ---
        rename_map = {
            "strength": "Strength",
            "weight_capacity": "Weight_Capacity",
            "cost_per_unit": "Cost_Per_Unit_INR",
            "biodegradability_score": "Biodegradability_Score",
            "recyclability": "Recyclability"
        }
        
        feature_order = ["Strength", "Weight_Capacity", "Cost_Per_Unit_INR", "Biodegradability_Score", "Recyclability"]
        
        # Prepare input for ML
        X_input = materials_df[list(rename_map.keys())].rename(columns=rename_map)
        X_input = X_input[feature_order]

        # ML Predictions (Scaling + XGBoost)
        if scaler and xgb_model:
            X_scaled = scaler.transform(X_input)
            xgb_preds = xgb_model.predict(X_scaled)
        else:
            # Fallback if models failed to load
            xgb_preds = materials_df["co2_emission_score"].values 

        predictions = []
        for i, (idx, row) in enumerate(materials_df.iterrows()):
            # Clip negative CO2 values to zero (Task 4 requirement)
            pred_co2 = max(0.0, float(xgb_preds[i]))

            # Normalization for Scoring
            s_norm = safe_normalize(row["strength"], materials_df["strength"])
            r_norm = safe_normalize(row["recyclability"], materials_df["recyclability"])
            b_norm = safe_normalize(row["biodegradability_score"], materials_df["biodegradability_score"])
            cost_norm = safe_normalize(row["cost_per_unit"], materials_df["cost_per_unit"])
            co2_norm = safe_normalize(row["co2_emission_score"], materials_df["co2_emission_score"])

            suitability_score = (0.4 * s_norm) + (0.3 * r_norm) + (0.3 * b_norm)
            
            final_score = (
                w_cost * (1 - cost_norm) +
                w_co2 * (1 - co2_norm) +
                w_suit * suitability_score
            )

            predictions.append({
                "material": row["material_type"],
                "predicted_cost": float(row["cost_per_unit"]),
                "predicted_co2": round(pred_co2, 2),
                "suitability_score": round(final_score, 2)
            })

        # Sort and return top 5
        df_results = pd.DataFrame(predictions)
        top_recommendations = df_results.sort_values("suitability_score", ascending=False).head(5)

        return jsonify({"recommended_materials": top_recommendations.to_dict(orient="records")})

    except Exception as e:
        print(f"Error in /recommend: {e}")
        return jsonify({"error": "Internal Server Error", "details": str(e)}), 500

if __name__ == "__main__":
    # Render provides a PORT environment variable
    port = int(os.environ.get("PORT", 5000))
    # Debug must be False for production (Task 4)
    app.run(host='0.0.0.0', port=port, debug=False)