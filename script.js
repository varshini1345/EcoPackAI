let allRecommendations = [];
let baselineCO2   = 50;   // example baseline
let baselineCost  = 120;

let chartUsageBar, chartPie, chartRankingBar, chartTrendsLine;

// --- CONFIGURATION ---
// Automatically switches between Local and Render based on where you are running it
const API_URL = window.location.hostname === '127.0.0.1' || window.location.hostname === 'localhost'
    ? 'http://127.0.0.1:5000' 
    : 'https://your-app-name.onrender.com'; // Change this to your Render URL after deployment

const form           = document.getElementById('productForm');
const resultsSection   = document.getElementById('results-section');
const dashboardSection  = document.getElementById('dashboard-section');
const resultsTableDiv   = document.getElementById('resultsTable');
const loading           = document.getElementById('loading');
const submitBtn         = document.getElementById('submitBtn');

form.addEventListener('submit', async (e) => {
  e.preventDefault();

  document.querySelectorAll('.error').forEach(el => el.style.display = 'none');

  let isValid = true;

  const category  = document.getElementById('product_category').value;
  const fragility = document.querySelector('input[name="fragility"]:checked')?.value;
  const weight    = document.getElementById('weight').value;
  const shipping  = document.querySelector('input[name="Shipping_Type"]:checked')?.value;
  const priority  = document.querySelector('input[name="Sustainability_Priority"]:checked')?.value;

  if (!category)  { document.getElementById('err_category').style.display = 'block'; isValid = false; }
  if (!fragility) { document.getElementById('err_fragility').style.display = 'block'; isValid = false; }
  if (!weight || Number(weight) <= 0) { document.getElementById('err_weight').style.display = 'block'; isValid = false; }
  if (!shipping)  { document.getElementById('err_shipping').style.display = 'block'; isValid = false; }
  if (!priority)  { document.getElementById('err_priority').style.display = 'block'; isValid = false; }

  if (!isValid) return;

  const payload = {
    product_category: category,
    fragility,
    Shipping_Type: shipping,
    Sustainability_Priority: priority,
    weight: parseFloat(weight)
  };

  resultsTableDiv.innerHTML = '';
  loading.style.display = 'block';
  submitBtn.disabled = true;

  try {
    // Calling the API
    const response = await fetch(`${API_URL}/recommend`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      throw new Error(`Server responded with ${response.status}`);
    }

    const data = await response.json();

    if (data.error) {
      alert('Backend error: ' + data.error);
      return;
    }

    const recommendations = data.recommended_materials || [];

    displayResults(recommendations);

    // Store for dashboard
    recommendations.forEach(mat => {
      allRecommendations.push({
        material: mat.material,
        cost: mat.predicted_cost,
        co2: mat.predicted_co2,
        score: mat.suitability_score,
        timestamp: new Date().toISOString()
      });
    });

    updateDashboard();

    resultsSection.style.display = 'block';
    dashboardSection.style.display = 'block';

  } catch (err) {
    console.error(err);
    alert(`Could not connect to backend at ${API_URL}.\nEnsure your Flask app is running!`);
  } finally {
    loading.style.display = 'none';
    submitBtn.disabled = false;
  }
});

function displayResults(materials) {
  if (!materials || materials.length === 0) {
    resultsTableDiv.innerHTML = '<p style="text-align:center; color:#64748b; padding:3rem 1rem;">No recommendations found for this combination.</p>';
    return;
  }

  let html = `
    <table id="rankingTable">
      <thead>
        <tr>
          <th>Rank</th>
          <th>Material</th>
          <th>Cost (₹)</th>
          <th>CO₂ Score</th>
          <th>Suitability</th>
        </tr>
      </thead>
      <tbody>
  `;

  materials.forEach((mat, index) => {
    html += `
      <tr>
        <td class="rank">#${index + 1}</td>
        <td>${mat.material}</td>
        <td>${Number(mat.predicted_cost).toFixed(2)}</td>
        <td>${Number(mat.predicted_co2).toFixed(2)}</td>
        <td style="font-weight:bold; color:#10b981;">${Number(mat.suitability_score).toFixed(2)}</td>
      </tr>
    `;
  });

  html += '</tbody></table>';
  resultsTableDiv.innerHTML = html;
}

function updateDashboard() {
  if (allRecommendations.length === 0) return;

  const materialCounts = {};
  allRecommendations.forEach(r => {
    materialCounts[r.material] = (materialCounts[r.material] || 0) + 1;
  });

  const labels = Object.keys(materialCounts);
  const counts = Object.values(materialCounts);

  const topMaterials = [...allRecommendations]
    .sort((a,b) => b.score - a.score)
    .slice(0, Math.min(5, allRecommendations.length));

  const avgCO2 = topMaterials.reduce((sum, m) => sum + m.co2, 0) / topMaterials.length || 0;
  const avgCost = topMaterials.reduce((sum, m) => sum + m.cost, 0) / topMaterials.length || 0;

  const co2Reduction = baselineCO2 > 0 ? ((baselineCO2 - avgCO2) / baselineCO2 * 100).toFixed(1) : 0;
  const costSaving   = baselineCost > 0 ? (baselineCost - avgCost).toFixed(0) : 0;

  document.getElementById('co2Reduction').textContent = `${co2Reduction}%`;
  document.getElementById('costSavings').textContent   = `₹ ${costSaving}`;
  document.getElementById('totalRecs').textContent     = allRecommendations.length;

  // --- CHARTS ---
  if (chartUsageBar) chartUsageBar.destroy();
  chartUsageBar = new Chart(document.getElementById('materialUsageBar'), {
    type: 'bar',
    data: {
      labels,
      datasets: [{
        label: 'Recommendation Count',
        data: counts,
        backgroundColor: 'rgba(38,166,154,0.75)',
        borderColor: '#00897b',
        borderWidth: 1
      }]
    },
    options: { scales: { y: { beginAtZero: true } }, plugins: { legend: { display: false } } }
  });

  if (chartPie) chartPie.destroy();
  chartPie = new Chart(document.getElementById('materialPie'), {
    type: 'pie',
    data: { labels, datasets: [{ data: counts, backgroundColor: ['#26a69a', '#ab47bc', '#66bb6a', '#ffa726', '#42a5f5'] }] }
  });

  const latestTop5 = [...allRecommendations]
    .slice(-5)
    .sort((a,b) => b.score - a.score)
    .map(m => ({ material: m.material, score: m.score }));

  if (chartRankingBar) chartRankingBar.destroy();
  chartRankingBar = new Chart(document.getElementById('rankingHorizontalBar'), {
    type: 'bar',
    data: {
      labels: latestTop5.map(m => m.material),
      datasets: [{
        label: 'Suitability Score',
        data: latestTop5.map(m => m.score),
        backgroundColor: 'rgba(38,166,154,0.8)',
        borderColor: '#00897b',
        borderWidth: 1
      }]
    },
    options: { indexAxis: 'y', scales: { x: { beginAtZero: true, max: 1 } }, plugins: { legend: { display: false } } }
  });

  if (chartTrendsLine) chartTrendsLine.destroy();
  chartTrendsLine = new Chart(document.getElementById('trendsLine'), {
    type: 'line',
    data: {
      labels: Array.from({length: allRecommendations.length}, (_,i) => `S-${i+1}`),
      datasets: [
        { label: 'Suitability Score', data: allRecommendations.map(m => m.score), borderColor: '#66bb6a', tension: 0.3 }
      ]
    }
  });
}