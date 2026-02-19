document.addEventListener("DOMContentLoaded", function () {

  console.log("EcoPackAI JS loaded successfully");

  let allRecommendations = [];
  let baselineCO2 = 50;
  let baselineCost = 120;

  let chartUsageBar = null;
  let chartPie = null;
  let chartRankingBar = null;
  let chartTrendsLine = null;

  // ✅ FIXED BACKEND URL (LOCAL FLASK)
const API_URL = "https://ecopackai-cdvs.onrender.com"

  const form = document.getElementById("productForm");
  const resultsSection = document.getElementById("results-section");
  const dashboardSection = document.getElementById("dashboard-section");
  const resultsTableDiv = document.getElementById("resultsTable");
  const loading = document.getElementById("loading");
  const submitBtn = document.getElementById("submitBtn");

  if (!form) {
    console.error("Form not found!");
    return;
  }

  // ---------------- FORM SUBMIT ----------------
  form.addEventListener("submit", async function (e) {
    e.preventDefault();

    const category  = document.getElementById("product_category")?.value;
    const fragility = document.querySelector('input[name="fragility"]:checked')?.value;
    const weight    = document.getElementById("weight")?.value;
    const shipping  = document.querySelector('input[name="Shipping_Type"]:checked')?.value;
    const priority  = document.querySelector('input[name="Sustainability_Priority"]:checked')?.value;

    if (!category || !fragility || !weight || !shipping || !priority) {
      resultsTableDiv.innerHTML =
        '<p style="color:red;text-align:center;">Please fill all required fields.</p>';
      return;
    }

    const payload = {
      product_category: category,
      fragility: fragility,
      Shipping_Type: shipping,
      Sustainability_Priority: priority,
      weight: parseFloat(weight)
    };

    resultsTableDiv.innerHTML = "";
    if (loading) loading.style.display = "block";
    if (submitBtn) submitBtn.disabled = true;

    try {
      const response = await fetch(`${API_URL}/recommend`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });

      if (!response.ok) {
        throw new Error(`Server error: ${response.status}`);
      }

      const data = await response.json();

      const recommendations = (data.recommended_materials || []).sort(
        (a, b) => Number(b.suitability_score) - Number(a.suitability_score)
      );

      allRecommendations = recommendations.map(mat => ({
        material: mat.material,
        cost: Math.max(0, Number(mat.predicted_cost) || 0),
        co2: Math.max(0, Number(mat.predicted_co2) || 0),
        score: Math.max(0, Number(mat.suitability_score) || 0)
      }));

      displayResults(allRecommendations);
      updateDashboard();

      if (resultsSection) resultsSection.style.display = "block";
      if (dashboardSection) dashboardSection.style.display = "block";

    } catch (err) {
      console.error("Fetch Error:", err);
      resultsTableDiv.innerHTML =
        '<p style="color:red;text-align:center;">Server connection failed. Please try again.</p>';
    } finally {
      if (loading) loading.style.display = "none";
      if (submitBtn) submitBtn.disabled = false;
    }
  });

  // ---------------- DISPLAY RESULTS ----------------
  function displayResults(materials) {

    if (!materials.length) {
      resultsTableDiv.innerHTML =
        '<p style="text-align:center; padding:2rem;">No recommendations found.</p>';
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
          <td>#${index + 1}</td>
          <td>${mat.material}</td>
          <td>${mat.cost.toFixed(2)}</td>
          <td>${mat.co2.toFixed(2)}</td>
          <td style="color:#10b981;font-weight:bold;">
            ${mat.score.toFixed(2)}
          </td>
        </tr>
      `;
    });

    html += "</tbody></table>";
    resultsTableDiv.innerHTML = html;
  }

  // ---------------- UPDATE DASHBOARD ----------------
  function updateDashboard() {

    if (!allRecommendations.length) return;

    const labels = allRecommendations.map(r => r.material);

    const avgCO2 =
      allRecommendations.reduce((sum, m) => sum + m.co2, 0) /
      allRecommendations.length;

    const avgCost =
      allRecommendations.reduce((sum, m) => sum + m.cost, 0) /
      allRecommendations.length;

    let co2Reduction = 0;
    if (baselineCO2 > 0) {
      co2Reduction = ((baselineCO2 - avgCO2) / baselineCO2) * 100;
    }
    if (co2Reduction < 0) co2Reduction = 0;

    document.getElementById("co2Reduction").textContent =
      `${co2Reduction.toFixed(1)}%`;

    let costDifference = baselineCost - avgCost;

    if (costDifference >= 0) {
      document.getElementById("costSavings").textContent =
        `₹ ${costDifference.toFixed(0)} Saved`;
    } else {
      document.getElementById("costSavings").textContent =
        `₹ ${Math.abs(costDifference).toFixed(0)} Higher`;
    }

    document.getElementById("totalRecs").textContent =
      allRecommendations.length;

    if (chartUsageBar) chartUsageBar.destroy();
    if (chartPie) chartPie.destroy();
    if (chartRankingBar) chartRankingBar.destroy();
    if (chartTrendsLine) chartTrendsLine.destroy();

    chartUsageBar = new Chart(document.getElementById("materialUsageBar"), {
      type: "bar",
      data: {
        labels: labels,
        datasets: [{
          label: "Suitability Score",
          data: allRecommendations.map(m => m.score)
        }]
      },
      options: { scales: { y: { beginAtZero: true } } }
    });

    chartPie = new Chart(document.getElementById("materialPie"), {
      type: "pie",
      data: {
        labels: labels,
        datasets: [{
          data: allRecommendations.map(m => m.score)
        }]
      }
    });

    chartRankingBar = new Chart(document.getElementById("rankingHorizontalBar"), {
      type: "bar",
      data: {
        labels: labels,
        datasets: [{
          label: "Final Score",
          data: allRecommendations.map(m => m.score)
        }]
      },
      options: { indexAxis: "y" }
    });

    chartTrendsLine = new Chart(document.getElementById("trendsLine"), {
      type: "line",
      data: {
        labels: labels,
        datasets: [{
          label: "CO₂ Emission",
          data: allRecommendations.map(m => m.co2),
          fill: false,
          tension: 0.3
        }]
      }
    });
  }

  // ---------------- EXPORT TO CSV ----------------
  window.exportToCSV = function () {

    if (!allRecommendations.length) {
      alert("No data to export.");
      return;
    }

    let csv = "Rank,Material,Cost,CO2,Suitability\n";

    allRecommendations.forEach((item, index) => {
      csv += `${index + 1},${item.material},${item.cost},${item.co2},${item.score}\n`;
    });

    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);

    const a = document.createElement("a");
    a.href = url;
    a.download = "EcoPackAI_Report.csv";
    a.click();

    URL.revokeObjectURL(url);
  };

  // ---------------- EXPORT TO PDF ----------------
  window.exportToPDF = function () {

    if (!allRecommendations.length) {
      alert("No data to export.");
      return;
    }

    const win = window.open("", "", "width=900,height=650");

    let html = `
      <h1>EcoPackAI Recommendation Report</h1>
      <table border="1" cellpadding="8" cellspacing="0">
        <tr>
          <th>Rank</th>
          <th>Material</th>
          <th>Cost</th>
          <th>CO2</th>
          <th>Suitability</th>
        </tr>
    `;

    allRecommendations.forEach((item, index) => {
      html += `
        <tr>
          <td>${index + 1}</td>
          <td>${item.material}</td>
          <td>${item.cost}</td>
          <td>${item.co2}</td>
          <td>${item.score}</td>
        </tr>
      `;
    });

    html += "</table>";

    win.document.write(html);
    win.document.close();
    win.print();
  };

});
