

import pandas as pd
import numpy as np
from sklearn.ensemble import IsolationForest, RandomForestRegressor
from sklearn.preprocessing import StandardScaler
from sklearn.model_selection import train_test_split
import joblib

def generate_synthetic_training_data(samples=10000):
    """Generates 15-feature dataset representing nominal and degraded EV states."""
    np.random.seed(42)
    
    # 15 Engineered Features for the Digital Twin
    data = {
        "v_bus": np.random.normal(380, 5, samples),            
        "i_load": np.random.normal(50, 15, samples),           
        "i_load": np.random.normal(50, 15, samples),
        "i_load": np.random.normal(50, 15, samples),           
        "t_core": np.random.normal(35, 8, samples),            
        "t_ambient": np.random.normal(25, 5, samples),         
        "soc": np.random.uniform(10, 100, samples),           
        "soh": np.random.uniform(80, 100, samples),           
        "coolant_flow": np.random.normal(5.0, 0.5, samples), 
        "rotor_rpm": np.random.normal(4000, 1000, samples),    
        "vibration_x": np.random.normal(0.02, 0.01, samples),  
        "vibration_y": np.random.normal(0.01, 0.005, samples), 
        "dt_rate": np.random.normal(0, 0.1, samples),          
        "dv_rate": np.random.normal(0, 0.5, samples),          
        "di_rate": np.random.normal(0, 2.0, samples),          
        "internal_res": np.random.normal(0.05, 0.01, samples), 
        "efficiency": np.random.normal(92, 3, samples)        
    }
    
    df = pd.DataFrame(data)
    
    # Target Variable: Remaining Useful Life (RUL) in hours
    # Formula assumes high temp, high vibration, and low efficiency degrade the RUL
    df["target_rul_hours"] = 10000 - (df["t_core"] * 50) - (df["vibration_x"] * 10000) + (df["efficiency"] * 20)
    
    return df

def train_models():
    print("Initializing Data Ingestion...")
    df = generate_synthetic_training_data()
    
    features = [col for col in df.columns if col != "target_rul_hours"]
    X = df[features]
    y = df["target_rul_hours"]
    
    # Standardize features for stable ML convergence
    scaler = StandardScaler()
    X_scaled = scaler.fit_transform(X)
    
    # Split Data
    X_train, X_test, y_train, y_test = train_test_split(X_scaled, y, test_size=0.2)
    
    print(f"Training on {len(features)} Features: {features}")
    
    # Model 1: Isolation Forest for Anomaly Detection (Unsupervised)
    print("Training Isolation Forest (Anomaly Detection)...")
    anomaly_model = IsolationForest(contamination=0.05, random_state=42, n_estimators=200)
    anomaly_model.fit(X_train)
    
    # Model 2: Random Forest for Remaining Useful Life (RUL) Prediction (Supervised)
    print("Training Random Forest Regressor (Predictive Maintenance)...")
    rul_model = RandomForestRegressor(n_estimators=100, max_depth=10, random_state=42)
    rul_model.fit(X_train, y_train)
    
    # Save models to disk (Mocked for showcase)
    # joblib.dump(anomaly_model, 'anomaly_model.pkl')
    # joblib.dump(rul_model, 'rul_model.pkl')
    # joblib.dump(scaler, 'feature_scaler.pkl')
    
    print("Training Complete. Models ready for edge deployment.")

if __name__ == "__main__":
    train_models()