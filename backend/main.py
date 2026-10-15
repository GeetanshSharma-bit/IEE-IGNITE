import asyncio
import random
import struct
import time
import json
import os
from datetime import datetime
from collections import deque
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

app = FastAPI()
app.mount("/static", StaticFiles(directory="../frontend"), name="static")

os.makedirs("blackbox_logs", exist_ok=True)

class ComprehensiveDigitalTwin:
    def __init__(self):
        self.target = {
            "BMS": {"v": 380.0, "i": 45.0, "t": 32.0},
            "MCU": {"v": 380.0, "i": 110.0, "t": 50.0},
            "OBC": {"v": 230.0, "i": 16.0, "t": 40.0}
        }
        # Baseline lifespan of Automotive Grade hardware is ~12,000 driving hours
        self.current = {
            "BMS": {"v": 380.0, "i": 45.0, "t": 32.0, "last_t": 32.0, "rul": 12000.0},
            "MCU": {"v": 380.0, "i": 110.0, "t": 50.0, "last_t": 50.0, "rul": 12000.0},
            "OBC": {"v": 230.0, "i": 16.0, "t": 40.0, "last_t": 40.0, "rul": 12000.0}
        }
        self.specs = {
            "BMS": {"nom_v": 380.0, "v_tol": 25.0, "max_i": 180.0, "nom_t": 28.0, "k_heat": 0.08},
            "MCU": {"nom_v": 380.0, "v_tol": 30.0, "max_i": 250.0, "nom_t": 35.0, "k_heat": 0.12},
            "OBC": {"nom_v": 230.0, "v_tol": 18.0, "max_i": 32.0,  "nom_t": 30.0, "k_heat": 0.25}
        }
        
        self.blackbox_buffer = {
            "BMS": deque(maxlen=240),
            "MCU": deque(maxlen=240),
            "OBC": deque(maxlen=240)
        }
        self.last_fault_dump = {"BMS": 0, "MCU": 0, "OBC": 0}

    def update_slider(self, ecu, v=None, i=None, t=None):
        if v is not None: self.target[ecu]["v"] = v
        if i is not None: self.target[ecu]["i"] = i
        if t is not None: self.target[ecu]["t"] = t

    def dump_blackbox(self, ecu, fault_mode):
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        filename = f"blackbox_logs/{ecu}_FAILURE_{timestamp}.json"
        data = {
            "ecu": ecu, "trigger_fault": fault_mode,
            "timestamp": timestamp, "telemetry_history": list(self.blackbox_buffer[ecu])
        }
        with open(filename, "w") as f:
            json.dump(data, f, indent=4)
        print(f"\n[!] CRITICAL FAILURE DETECTED: {fault_mode}")
        print(f"[*] BLACK BOX SAVED: Past 2 minutes of {ecu} data written to {filename}\n")

    def step(self, ecu):
        alpha = 0.2
        c = self.current[ecu]
        tar = self.target[ecu]
        spec = self.specs[ecu]

        c["v"] += (tar["v"] - c["v"]) * alpha
        c["i"] += (tar["i"] - c["i"]) * alpha
        c["last_t"] = c["t"]
        c["t"] += (tar["t"] - c["t"]) * (alpha * 0.35)

        live_v = c["v"] + random.uniform(-0.3, 0.3)
        live_i = c["i"] + random.uniform(-0.6, 0.6)
        live_t = c["t"] + random.uniform(-0.08, 0.08)

        expected_t = spec["nom_t"] + (max(0, live_i) * spec["k_heat"])
        thermal_residual = live_t - expected_t
        dt_rate = (live_t - c["last_t"]) / 0.5

        v_diff = abs(live_v - spec["nom_v"])
        v_stress = max(0.0, (v_diff - spec["v_tol"]) * 2.8)
        i_stress = max(0.0, (live_i - spec["max_i"]) * 1.5)
        t_stress = (abs(thermal_residual) * 2.2) + (max(0.0, dt_rate) * 35.0)

        anomaly_score = v_stress + i_stress + t_stress
        anomaly_pct = round(max(0.0, min(100.0, anomaly_score)), 1)

        if live_v > (spec["nom_v"] + spec["v_tol"]): fault_mode = "OVERVOLTAGE CELL STRESS"
        elif live_v < (spec["nom_v"] - spec["v_tol"]): fault_mode = "BUS UNDERVOLTAGE SAG"
        elif live_t > 65.0 or dt_rate > 1.5: fault_mode = "CRITICAL THERMAL SPIKE"
        elif anomaly_pct > 35.0: fault_mode = "SUB-SYSTEM DEGRADATION"
        else: fault_mode = "SYSTEM NOMINAL"

        # --- FIX: HIGH-ACCURACY EXPONENTIAL DEGRADATION (ARRHENIUS-INSPIRED) ---
        # 0% Anomaly   = ~12,000 Hours (Years of driving)
        # 50% Anomaly  = ~3 Hours (Immediate Maintenance Required)
        # 100% Anomaly = ~0.001 Hours (Fails in 3.6 Seconds)
        decay_rate = 0.85
        raw_rul = 12000.0 * (decay_rate ** anomaly_pct)
        
        # Asymmetric smoothing: Hardware breaks fast under stress, but "heals" slowly
        if raw_rul < c["rul"]:
            c["rul"] += (raw_rul - c["rul"]) * 0.15 
        else:
            c["rul"] += (raw_rul - c["rul"]) * 0.02
            
        rul_hours = round(c["rul"], 4)

        frame_data = {
            "time": datetime.now().isoformat(), "v": round(live_v, 2),
            "i": round(live_i, 2), "t": round(live_t, 2),
            "anomaly_pct": anomaly_pct, "fault_mode": fault_mode
        }
        self.blackbox_buffer[ecu].append(frame_data)

        current_time = time.time()
        if anomaly_pct > 70.0 and (current_time - self.last_fault_dump[ecu] > 120):
            self.last_fault_dump[ecu] = current_time
            self.dump_blackbox(ecu, fault_mode)

        v_int, i_int, t_int = int(live_v * 10), int(abs(live_i) * 10), int(live_t * 10)
        checksum = (v_int + i_int + t_int) & 0xFF
        raw_bytes = struct.pack(">HHHBB", v_int, i_int, t_int, int(anomaly_pct), checksum)
        hex_str = " ".join(f"{b:02X}" for b in raw_bytes)

        return {
            "v": round(live_v, 1), "i": round(live_i, 1), "t": round(live_t, 1),
            "expected_t": round(expected_t, 1), "res_t": round(thermal_residual, 2), "dt_rate": round(dt_rate, 2),
            "anomaly": anomaly_pct, "rul_hours": rul_hours, "fault_mode": fault_mode, "raw_hex": hex_str
        }

twin = ComprehensiveDigitalTwin()

class OverrideData(BaseModel):
    ecu: str
    v: float = None
    i: float = None
    t: float = None

@app.get("/")
def serve_home(): return FileResponse("../frontend/index.html")

@app.get("/api/blackbox/{ecu}")
def get_blackbox(ecu: str): return JSONResponse(content={"ecu": ecu, "data": list(twin.blackbox_buffer.get(ecu, []))})

@app.post("/api/override")
def override_telemetry(data: OverrideData):
    twin.update_slider(data.ecu, v=data.v, i=data.i, t=data.t)
    return {"status": "ok"}

@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    await websocket.accept()
    try:
        while True:
            await websocket.send_json({"BMS": twin.step("BMS"), "MCU": twin.step("MCU"), "OBC": twin.step("OBC")})
            await asyncio.sleep(0.5)
    except WebSocketDisconnect: pass

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="127.0.0.1", port=8000)