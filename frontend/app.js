/* =========================================================
   SCADA DIGITAL TWIN ENGINE & THREE.JS INTERACTION (LIGHT THEME)
   ========================================================= */

let activeECU = 'BMS';
let telemetryFeed = {};
let ecuStates = { BMS: 'NOMINAL', MCU: 'NOMINAL', OBC: 'NOMINAL' };
let hasLogs = false;

// UI Element Handles
const kpiTarget = document.getElementById('kpi-target');
const kpiFault = document.getElementById('kpi-fault');
const kpiAnomaly = document.getElementById('kpi-anomaly');
const kpiRUL = document.getElementById('kpi-rul');

const sliderV = document.getElementById('slider-v');
const sliderI = document.getElementById('slider-i');
const sliderT = document.getElementById('slider-t');
const valV = document.getElementById('val-v');
const valI = document.getElementById('val-i');
const valT = document.getElementById('val-t');
const vecExpT = document.getElementById('vec-exp-t');
const vecResT = document.getElementById('vec-res-t');
const vecDtRate = document.getElementById('vec-dt-rate');
const canFeed = document.getElementById('can-feed');

// Alert Handles
const alertPopup = document.getElementById('alert-popup');
const alertTitle = document.getElementById('alert-title');
const alertRUL = document.getElementById('alert-rul');
let currentAlertState = 'NOMINAL'; 

function closeAlert() {
  alertPopup.classList.remove('show');
  setTimeout(() => alertPopup.classList.add('hidden'), 500);
}

function formatRUL(hours) {
  if (hours > 24) return (hours / 24).toFixed(1) + ' Days';
  if (hours >= 1) return hours.toFixed(1) + ' Hrs';
  const mins = hours * 60;
  if (mins >= 1) return mins.toFixed(1) + ' Mins';
  const secs = mins * 60;
  return Math.max(0, secs).toFixed(1) + ' Secs';
}

const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
function playQuirkyAlertSound(type) {
  if (audioCtx.state === 'suspended') audioCtx.resume();
  const osc = audioCtx.createOscillator();
  const gain = audioCtx.createGain();
  osc.connect(gain); gain.connect(audioCtx.destination);
  const now = audioCtx.currentTime;
  
  if (type === 'WARNING') {
    osc.type = 'sine';
    osc.frequency.setValueAtTime(300, now);
    osc.frequency.exponentialRampToValueAtTime(600, now + 0.1);
    osc.frequency.setValueAtTime(400, now + 0.15);
    osc.frequency.exponentialRampToValueAtTime(800, now + 0.25);
    gain.gain.setValueAtTime(0.3, now);
    gain.gain.exponentialRampToValueAtTime(0.01, now + 0.4);
    osc.start(now); osc.stop(now + 0.4);
  } else if (type === 'CRITICAL') {
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(400, now);
    osc.frequency.exponentialRampToValueAtTime(100, now + 0.35);
    
    const osc2 = audioCtx.createOscillator();
    osc2.type = 'square';
    osc2.frequency.setValueAtTime(420, now);
    osc2.frequency.exponentialRampToValueAtTime(120, now + 0.35);
    osc2.connect(gain); osc2.start(now); osc2.stop(now + 0.35);

    gain.gain.setValueAtTime(0.2, now); 
    gain.gain.exponentialRampToValueAtTime(0.01, now + 0.35);
    osc.start(now); osc.stop(now + 0.35);
  }
}

const sidebarToggle = document.getElementById('sidebar-toggle');
const sidebar = document.getElementById('sidebar');
if(sidebarToggle) sidebarToggle.addEventListener('click', () => sidebar.classList.toggle('collapsed'));

const ecuProfiles = {
  BMS: { title: "BMS Battery Core", vMin: 280, vMax: 460, defaultV: 380, iMax: 200, defaultI: 45, defaultT: 32 },
  MCU: { title: "MCU Traction Inverter", vMin: 280, vMax: 460, defaultV: 380, iMax: 300, defaultI: 110, defaultT: 50 },
  OBC: { title: "OBC Charger Ingress", vMin: 180, vMax: 270, defaultV: 230, iMax: 36, defaultI: 16, defaultT: 40 }
};

function selectECU(ecu) {
  activeECU = ecu;
  document.getElementById('dashboard-view').style.display = 'flex';
  document.getElementById('health-view').style.display = 'none';
  document.getElementById('history-view').style.display = 'none';

  document.querySelectorAll('.nav-btn').forEach(btn => btn.classList.remove('active'));
  const btn = document.getElementById(`btn-${ecu}`);
  if (btn) btn.classList.add('active');

  kpiTarget.innerText = ecuProfiles[ecu].title;
  sliderV.min = ecuProfiles[ecu].vMin; sliderV.max = ecuProfiles[ecu].vMax; sliderI.max = ecuProfiles[ecu].iMax;

  if (telemetryFeed[ecu]) {
    sliderV.value = telemetryFeed[ecu].v; sliderI.value = telemetryFeed[ecu].i; sliderT.value = telemetryFeed[ecu].t;
  }
  Object.values(Chart.instances).forEach(chart => chart.resize());
}

function selectHealth() {
  document.getElementById('dashboard-view').style.display = 'none';
  document.getElementById('health-view').style.display = 'flex';
  document.getElementById('history-view').style.display = 'none';

  document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
  document.getElementById('btn-health').classList.add('active');

  kpiTarget.innerText = "Fleet Health Diagnostics";
  kpiFault.innerText = "SOH ADVISORY ACTIVE";
  kpiFault.className = 'kpi-val text-blue';
  kpiAnomaly.innerText = "--%"; kpiRUL.innerText = "-- Hrs";
  
  if (chartHealthTimeline) chartHealthTimeline.resize();
}

function selectHistory() {
  document.getElementById('dashboard-view').style.display = 'none';
  document.getElementById('health-view').style.display = 'none';
  document.getElementById('history-view').style.display = 'flex';

  document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
  document.getElementById('btn-history').classList.add('active');

  kpiTarget.innerText = "System Failure History";
  kpiFault.innerText = "VIEWING EVENT LOGS";
  kpiFault.className = 'kpi-val text-blue';
  kpiAnomaly.innerText = "--%"; kpiRUL.innerText = "-- Hrs";
}

function addLogEntry(ecu, faultMode, severity, rul) {
  const historyTbody = document.getElementById('history-tbody');
  if (!hasLogs) { historyTbody.innerHTML = ''; hasLogs = true; }
  
  const tr = document.createElement('tr');
  const time = new Date().toLocaleTimeString();
  let badgeClass = 'resolved';
  if (severity === 'CRITICAL') badgeClass = 'critical';
  if (severity === 'WARNING') badgeClass = 'warning';
  
  tr.innerHTML = `<td class="mono text-dim">${time}</td><td style="font-weight: 800; color: var(--text-pure);">${ecu}</td><td style="color: var(--text-muted);">${faultMode}</td><td><span class="badge badge-${badgeClass}">${severity}</span></td><td class="mono text-blue">${formatRUL(rul)}</td>`;
  historyTbody.insertBefore(tr, historyTbody.firstChild);
}

[sliderV, sliderI, sliderT].forEach(slider => {
  slider.addEventListener('input', (e) => {
    if (e.target === sliderV) valV.innerText = e.target.value + ' V';
    if (e.target === sliderI) valI.innerText = e.target.value + ' A';
    if (e.target === sliderT) valT.innerText = e.target.value + ' °C';
  });
  slider.addEventListener('change', (e) => {
    fetch('/api/override', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ecu: activeECU, v: parseFloat(sliderV.value), i: parseFloat(sliderI.value), t: parseFloat(sliderT.value) }) });
  });
});

const btnBlackbox = document.getElementById('btn-blackbox');
if (btnBlackbox) {
  btnBlackbox.addEventListener('click', () => {
    fetch(`/api/blackbox/${activeECU}`).then(res => res.json()).then(data => {
      const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(data, null, 2));
      const downloadNode = document.createElement('a');
      downloadNode.setAttribute("href", dataStr); downloadNode.setAttribute("download", `${activeECU}_FlightRecord.json`);
      document.body.appendChild(downloadNode); downloadNode.click(); downloadNode.remove();
    });
  });
}

Chart.defaults.color = '#64748b'; Chart.defaults.font.family = "'JetBrains Mono', monospace"; Chart.defaults.font.size = 10;
const baseChartConfig = { responsive: true, maintainAspectRatio: false, animation: false, elements: { point: { radius: 0 } }, plugins: { legend: { display: false } }, scales: { x: { display: false }, y: { grid: { color: 'rgba(15, 23, 42, 0.05)' } } } };

const chartCurrent = new Chart(document.getElementById('chart-current'), { type: 'line', data: { labels: [], datasets: [{ data: [], borderColor: '#d97706', borderWidth: 2, tension: 0.25 }] }, options: baseChartConfig });
const chartVoltage = new Chart(document.getElementById('chart-voltage'), { type: 'line', data: { labels: [], datasets: [{ data: [], borderColor: '#0284c7', borderWidth: 2, tension: 0.25 }] }, options: baseChartConfig });
const chartThermal = new Chart(document.getElementById('chart-thermal'), { type: 'line', data: { labels: [], datasets: [ { label: 'Sensor', data: [], borderColor: '#dc2626', borderWidth: 2, tension: 0.25 }, { label: 'Twin', data: [], borderColor: '#0284c7', borderDash: [4, 4], borderWidth: 1.5, tension: 0.25 } ] }, options: { ...baseChartConfig, plugins: { legend: { display: true, labels: { boxWidth: 8, color: '#0f172a' } } } } });
const chartRUL = new Chart(document.getElementById('chart-rul'), { type: 'line', data: { labels: [], datasets: [{ data: [], borderColor: '#059669', backgroundColor: 'rgba(5, 150, 105, 0.1)', fill: true, borderWidth: 2, tension: 0.3 }] }, options: { ...baseChartConfig, scales: { x: { display: false }, y: { suggestedMin: 0, suggestedMax: 12000, grid: { color: 'rgba(15, 23, 42, 0.05)' } } } } });

const chartHealthTimeline = new Chart(document.getElementById('chart-health-timeline'), {
  type: 'line',
  data: {
    labels: [],
    datasets: [{
      label: 'Fleet SOH %',
      data: [],
      borderColor: '#0284c7',
      backgroundColor: 'rgba(2, 132, 199, 0.08)',
      fill: true,
      borderWidth: 2.5,
      tension: 0.2
    }]
  },
  options: {
    ...baseChartConfig,
    scales: {
      x: { display: false },
      y: { suggestedMin: 40, suggestedMax: 100, grid: { color: 'rgba(15, 23, 42, 0.05)' } }
    }
  }
});

function appendTelemetryData(chart, val, valSecondary = null) {
  chart.data.labels.push(''); chart.data.datasets[0].data.push(val);
  if (valSecondary !== null && chart.data.datasets[1]) chart.data.datasets[1].data.push(valSecondary);
  if (chart.data.labels.length > 25) { chart.data.labels.shift(); chart.data.datasets[0].data.shift(); if (chart.data.datasets[1]) chart.data.datasets[1].data.shift(); }
  chart.update();
}

function updateProgressBar(fillEl, valEl, val) {
  fillEl.style.width = val + '%';
  valEl.innerText = val.toFixed(1) + '%';
  fillEl.className = 'progress-fill';
  if (val < 70) fillEl.classList.add('crit');
  else if (val < 88) fillEl.classList.add('warn');
}

const ws = new WebSocket(`ws://${window.location.host}/ws`);
ws.onmessage = (event) => {
  telemetryFeed = JSON.parse(event.data);
  const d = telemetryFeed[activeECU];
  const h = telemetryFeed.HEALTH;
  if (!d) return;

  const isLiveView = document.getElementById('dashboard-view').style.display === 'flex';

  // --- HEALTH DASHBOARD UPDATES ---
  if (h) {
    document.getElementById('health-vehicle-soh').innerText = h.vehicle_soh.toFixed(1) + '%';
    document.getElementById('health-stress-count').innerText = h.total_stress_events;
    
    // Calculate wear multiplier relative to stress count
    const mult = (1.0 + (h.total_stress_events * 0.35)).toFixed(1);
    document.getElementById('health-wear-rate').innerText = mult + 'x';
    
    const statusBadge = document.getElementById('health-status-badge');
    statusBadge.innerText = h.status;
    statusBadge.className = 'badge';
    if (h.vehicle_soh > 88) statusBadge.classList.add('badge-resolved');
    else if (h.vehicle_soh > 70) statusBadge.classList.add('badge-warning');
    else statusBadge.classList.add('badge-critical');

    updateProgressBar(document.getElementById('soh-bar-bms'), document.getElementById('soh-bar-bms-val'), h.bms_soh);
    updateProgressBar(document.getElementById('soh-bar-mcu'), document.getElementById('soh-bar-mcu-val'), h.mcu_soh);
    updateProgressBar(document.getElementById('soh-bar-obc'), document.getElementById('soh-bar-obc-val'), h.obc_soh);

    appendTelemetryData(chartHealthTimeline, h.vehicle_soh);
  }

  // --- LOGGING ENGINE (BACKGROUND) ---
  ['BMS', 'MCU', 'OBC'].forEach(ecuName => {
    const eData = telemetryFeed[ecuName];
    let eState = 'NOMINAL';
    if (eData.anomaly > 50) eState = 'CRITICAL'; else if (eData.anomaly > 20) eState = 'WARNING';
    if (eState !== 'NOMINAL' && ecuStates[ecuName] === 'NOMINAL') addLogEntry(ecuName, eData.fault_mode, eState, eData.rul_hours);
    else if (eState === 'NOMINAL' && ecuStates[ecuName] !== 'NOMINAL') addLogEntry(ecuName, "SYSTEM RESTORED TO NOMINAL", 'RESOLVED', eData.rul_hours);
    ecuStates[ecuName] = eState;
  });

  let newState = 'NOMINAL';
  if (d.anomaly > 50) newState = 'CRITICAL'; else if (d.anomaly > 20) newState = 'WARNING';

  if (isLiveView) {
    kpiAnomaly.innerText = d.anomaly.toFixed(1) + '%';
    kpiRUL.innerText = formatRUL(d.rul_hours);
    kpiFault.innerText = d.fault_mode;
    if (newState === 'CRITICAL') { kpiFault.className = 'kpi-val text-red'; kpiAnomaly.className = 'kpi-val text-red'; } 
    else if (newState === 'WARNING') { kpiFault.className = 'kpi-val text-amber'; kpiAnomaly.className = 'kpi-val text-amber'; } 
    else { kpiFault.className = 'kpi-val text-green'; kpiAnomaly.className = 'kpi-val text-blue'; }
  }

  if (alertPopup && newState !== currentAlertState && newState !== 'NOMINAL') {
    alertPopup.classList.remove('hidden', 'warning', 'critical');
    playQuirkyAlertSound(newState);
    if (newState === 'CRITICAL') { alertPopup.classList.add('critical'); alertTitle.innerText = "CRITICAL HARDWARE ALERT: " + d.fault_mode; } 
    else { alertPopup.classList.add('warning'); alertTitle.innerText = "DEGRADATION WARNING: " + d.fault_mode; }
    setTimeout(() => alertPopup.classList.add('show'), 50);
  } else if (alertPopup && newState === 'NOMINAL' && currentAlertState !== 'NOMINAL') {
    closeAlert();
  }
  currentAlertState = newState;

  if (alertPopup && alertPopup.classList.contains('show')) alertRUL.innerText = formatRUL(d.rul_hours);

  vecExpT.innerText = d.expected_t.toFixed(1) + ' °C'; vecResT.innerText = d.res_t.toFixed(2) + ' °C';
  vecDtRate.innerText = d.dt_rate.toFixed(2) + ' °C/s'; canFeed.innerText = d.raw_hex;

  if (document.activeElement !== sliderV) { sliderV.value = d.v; valV.innerText = d.v.toFixed(1) + ' V'; }
  if (document.activeElement !== sliderI) { sliderI.value = d.i; valI.innerText = d.i.toFixed(1) + ' A'; }
  if (document.activeElement !== sliderT) { sliderT.value = d.t; valT.innerText = d.t.toFixed(1) + ' °C'; }

  appendTelemetryData(chartCurrent, d.i); appendTelemetryData(chartVoltage, d.v);
  appendTelemetryData(chartThermal, d.t, d.expected_t); appendTelemetryData(chartRUL, d.rul_hours);
};

window.addEventListener('DOMContentLoaded', () => {
  const container = document.getElementById('canvas-container');
  if (!container) return;

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(40, container.clientWidth / container.clientHeight, 0.1, 100);
  camera.position.set(2.2, 1.2, 2.8);

  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setSize(container.clientWidth, container.clientHeight);
  renderer.shadowMap.enabled = true; renderer.toneMapping = THREE.ACESFilmicToneMapping;
  container.appendChild(renderer.domElement);

  const controls = new THREE.OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true; controls.dampingFactor = 0.05; controls.target.set(0, 0.45, 0);

  scene.add(new THREE.AmbientLight(0xffffff, 1.2));
  const spot = new THREE.SpotLight(0xffffff, 2.5); spot.position.set(4, 8, 4); scene.add(spot);

  const bmsMat = new THREE.MeshStandardMaterial({ color: 0x0ea5e9, emissive: 0x0ea5e9, emissiveIntensity: 0.8 });
  const mcuMat = new THREE.MeshStandardMaterial({ color: 0x8b5cf6, emissive: 0x8b5cf6, emissiveIntensity: 0.8 });
  const obcMat = new THREE.MeshStandardMaterial({ color: 0xf59e0b, emissive: 0xf59e0b, emissiveIntensity: 0.8 });
  const bmsMesh = new THREE.Mesh(new THREE.BoxGeometry(0.45, 0.12, 0.85), bmsMat); bmsMesh.position.set(0, 0.22, 0.1); bmsMesh.userData = { ecu: 'BMS' };
  const mcuMesh = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.25, 0.32), mcuMat); mcuMesh.position.set(0, 0.45, -0.75); mcuMesh.userData = { ecu: 'MCU' };
  const obcMesh = new THREE.Mesh(new THREE.BoxGeometry(0.38, 0.22, 0.42), obcMat); obcMesh.position.set(0, 0.78, -0.32); obcMesh.userData = { ecu: 'OBC' };

  const interactiveModules = [bmsMesh, mcuMesh, obcMesh];
  interactiveModules.forEach(m => scene.add(m));

  const loader = new THREE.GLTFLoader();
  loader.load('/static/scooter.glb', (gltf) => {
    const model = gltf.scene; model.scale.set(1.8, 1.8, 1.8); model.position.set(0, -0.1, 0);
    const frostedGlass = new THREE.MeshPhysicalMaterial({ color: 0x475569, metalness: 0.15, roughness: 0.15, transmission: 0.55, opacity: 0.9, transparent: true });
    model.traverse((child) => { if (child.isMesh) { child.material = frostedGlass; child.castShadow = true; } });
    scene.add(model);
  });

  const raycaster = new THREE.Raycaster(); const mouse = new THREE.Vector2();
  function checkRaycast(event) {
    const rect = container.getBoundingClientRect();
    mouse.x = ((event.clientX - rect.left) / container.clientWidth) * 2 - 1;
    mouse.y = -((event.clientY - rect.top) / container.clientHeight) * 2 + 1;
    raycaster.setFromCamera(mouse, camera); return raycaster.intersectObjects(interactiveModules);
  }
  container.addEventListener('mousemove', (e) => { container.style.cursor = checkRaycast(e).length > 0 ? 'pointer' : 'grab'; });
  container.addEventListener('pointerdown', (e) => { const hits = checkRaycast(e); if (hits.length > 0) selectECU(hits[0].object.userData.ecu); });

  const clock = new THREE.Clock();
  function animate() {
    requestAnimationFrame(animate); controls.update();
    const t = clock.getElapsedTime();
    bmsMesh.material.emissiveIntensity = activeECU === 'BMS' ? 0.8 + Math.sin(t * 5) * 0.3 : 0.15;
    mcuMesh.material.emissiveIntensity = activeECU === 'MCU' ? 0.8 + Math.sin(t * 5) * 0.3 : 0.15;
    obcMesh.material.emissiveIntensity = activeECU === 'OBC' ? 0.8 + Math.sin(t * 5) * 0.3 : 0.15;
    renderer.render(scene, camera);
  }
  animate();

  const resizeObserver = new ResizeObserver(() => {
    if (container.clientWidth > 0 && container.clientHeight > 0) {
      camera.aspect = container.clientWidth / container.clientHeight;
      camera.updateProjectionMatrix(); renderer.setSize(container.clientWidth, container.clientHeight);
    }
  });
  resizeObserver.observe(container);
  window.addEventListener('resize', () => { Object.values(Chart.instances).forEach(chart => chart.resize()); });
});