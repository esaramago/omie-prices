<script>
  import { onMount } from 'svelte';

  // State using Svelte 5 Runes
  let selectedDate = $state(new Date().toISOString().split('T')[0]);
  let selectedCountry = $state('PT');
  let prices = $state([]);
  let loading = $state(true);
  let error = $state(null);
  let apiStatus = $state(null);
  
  let chartElement = $state(null);
  let chart = null;

  // Chart View Mode: 'hourly' or 'quarterly'
  let chartViewMode = $state('hourly');

  // Helpers
  function periodToTime(period) {
    const totalMinutes = (period - 1) * 15;
    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;
    const hStr = String(hours).padStart(2, '0');
    const mStr = String(minutes).padStart(2, '0');
    return `${hStr}:${mStr}`;
  }

  function getCurrentPeriod() {
    const now = new Date();
    const hours = now.getHours();
    const minutes = now.getMinutes();
    const period = Math.floor(hours * 4) + Math.floor(minutes / 15) + 1;
    return Math.min(Math.max(period, 1), 96);
  }

  // Derived state: aggregate 15-minute periods into hourly averages for the chart
  const hourlyPrices = $derived.by(() => {
    if (prices.length === 0) return [];
    const hourly = [];
    for (let h = 0; h < 24; h++) {
      const hourPeriods = prices.filter(p => Math.floor((p.period - 1) / 4) === h);
      if (hourPeriods.length > 0) {
        const avgPrice = hourPeriods.reduce((sum, p) => sum + p.price, 0) / hourPeriods.length;
        hourly.push({
          price: avgPrice,
          time: `${String(h).padStart(2, '0')}:00`
        });
      }
    }
    return hourly;
  });

  // Derived Values (using raw 15-minute prices)
  const averagePrice = $derived(
    prices.length > 0
      ? prices.reduce((sum, p) => sum + p.price, 0) / prices.length
      : 0
  );

  const minPriceRecord = $derived(
    prices.length > 0
      ? prices.reduce((min, p) => (p.price < min.price ? p : min), prices[0])
      : null
  );

  const maxPriceRecord = $derived(
    prices.length > 0
      ? prices.reduce((max, p) => (p.price > max.price ? p : max), prices[0])
      : null
  );

  const currentPeriod = getCurrentPeriod();
  const currentPriceRecord = $derived(
    prices.length > 0 ? prices.find((p) => p.period === currentPeriod) : null
  );

  const isSelectedDateToday = $derived(
    selectedDate === new Date().toISOString().split('T')[0]
  );

  // Fetch prices from Express API
  async function loadData() {
    loading = true;
    error = null;
    try {
      const res = await fetch(`/api/prices?country=${selectedCountry}&start=${selectedDate}&end=${selectedDate}`);
      if (!res.ok) {
        throw new Error('Erro ao obter os preços da API.');
      }
      prices = await res.json();
    } catch (err) {
      error = err.message;
      prices = [];
    } finally {
      loading = false;
    }
  }

  // Fetch general DB stats
  async function loadStatus() {
    try {
      const res = await fetch('/api/status');
      if (res.ok) {
        apiStatus = await res.json();
      }
    } catch (err) {
      console.error('Erro ao obter estado da API:', err);
    }
  }

  // Trigger load when selected parameters change
  $effect(() => {
    loadData();
  });

  onMount(() => {
    loadStatus();
    // Refresh API status and current period calculations every 5 minutes
    const interval = setInterval(() => {
      loadStatus();
    }, 5 * 60 * 1000);
    return () => clearInterval(interval);
  });

  // Chart Rendering effect
  $effect(() => {
    if (prices.length > 0 && chartElement) {
      const displayData = chartViewMode === 'hourly' ? hourlyPrices : prices.map(p => ({
        price: p.price,
        time: periodToTime(p.period)
      }));
      const seriesData = displayData.map((p) => p.price);
      const categories = displayData.map((p) => p.time);

      const options = {
        chart: {
          type: 'bar',
          height: 350,
          fontFamily: 'Outfit, sans-serif',
          toolbar: { show: false },
          animations: { enabled: true },
          background: 'transparent'
        },
        theme: { mode: 'dark' },
        plotOptions: {
          bar: {
            horizontal: false,
            columnWidth: '70%',
            borderRadius: 6,
            borderRadiusApplication: 'end'
          }
        },
        dataLabels: {
          enabled: false
        },
        colors: ['#00f2fe'],
        stroke: { show: false },
        fill: {
          type: 'gradient',
          gradient: {
            shade: 'dark',
            type: 'vertical',
            shadeIntensity: 0.5,
            gradientToColors: ['#4facfe'],
            inverseColors: false,
            opacityFrom: 0.85,
            opacityTo: 0.2,
            stops: [0, 100]
          }
        },
        series: [
          {
            name: `Preço (${selectedCountry})`,
            data: seriesData
          }
        ],
        xaxis: {
          categories: categories,
          labels: {
            show: true,
            rotate: -45,
            rotateAlways: false,
            hideOverlappingLabels: true,
            style: { colors: '#94a3b8', fontSize: '11px' }
          },
          axisBorder: { show: false },
          axisTicks: { show: false }
        },
        yaxis: {
          labels: {
            style: { colors: '#94a3b8' },
            formatter: (value) => `${value.toFixed(2)} €`
          }
        },
        grid: {
          borderColor: 'rgba(255, 255, 255, 0.06)',
          strokeDashArray: 4
        },
        tooltip: {
          theme: 'dark',
          x: { show: true },
          y: { formatter: (value) => `${value.toFixed(2)} €/MWh` }
        }
      };

      if (chart) {
        chart.updateOptions(options);
      } else {
        import('apexcharts').then(({ default: ApexCharts }) => {
          chart = new ApexCharts(chartElement, options);
          chart.render();
        });
      }
    } else {
      if (chart) {
        chart.destroy();
        chart = null;
      }
    }
  });

  function getPriceClass(price) {
    if (price < averagePrice * 0.9) return 'cheap';
    if (price > averagePrice * 1.1) return 'expensive';
    return 'normal';
  }

  function getPriceLabel(price) {
    if (price < averagePrice * 0.9) return 'Barato';
    if (price > averagePrice * 1.1) return 'Caro';
    return 'Normal';
  }
</script>

<svelte:head>
  <title>OMIE Energy Monitor - Dashboard</title>
</svelte:head>

<main class="dashboard-container">
  <!-- Header Section -->
  <header class="dashboard-header">
    <div class="brand">
      <div class="logo-icon">⚡</div>
      <div>
        <h1>OMIE Energy Monitor</h1>
        <p class="subtitle">Preços horários e quarto-horários do mercado ibérico</p>
      </div>
    </div>
    
    <div class="controls-panel">
      <!-- Country Picker -->
      <div class="segmented-control">
        <button 
          class="control-btn" 
          class:active={selectedCountry === 'PT'} 
          onclick={() => selectedCountry = 'PT'}
        >
          Portugal
        </button>
        <button 
          class="control-btn" 
          class:active={selectedCountry === 'ES'} 
          onclick={() => selectedCountry = 'ES'}
        >
          Espanha
        </button>
      </div>

      <!-- Date Picker -->
      <div class="date-input-wrapper">
        <input 
          id="date-picker"
          type="date" 
          value={selectedDate} 
          onchange={(e) => selectedDate = e.target.value}
        />
      </div>
    </div>
  </header>

  <!-- Error State -->
  {#if error}
    <section class="alert alert-error">
      <div class="alert-content">
        <span class="alert-icon">⚠️</span>
        <div>
          <h3>Erro ao carregar dados</h3>
          <p>{error}</p>
        </div>
      </div>
      <button class="btn btn-retry" onclick={loadData}>Tentar novamente</button>
    </section>
  {/if}

  <!-- Loading State -->
  {#if loading}
    <div class="loader-overlay">
      <div class="spinner"></div>
      <p>A carregar preços de energia...</p>
    </div>
  {:else if prices.length === 0 && !error}
    <section class="alert alert-info">
      <span class="alert-icon">ℹ️</span>
      <div>
        <h3>Sem dados disponíveis</h3>
        <p>Não foram encontrados preços para a data selecionada ({selectedDate}). O mercado da OMIE pode ainda não ter publicado os preços para amanhã.</p>
      </div>
    </section>
  {:else if prices.length > 0}
    <!-- Stats Grid -->
    <section class="stats-grid">
      <!-- Stat 1: Current Price -->
      <div class="stat-card" class:highlight-pulse={isSelectedDateToday}>
        <div class="card-glow glow-cyan"></div>
        <div class="stat-header">
          <span class="stat-label">Preço Atual</span>
          <span class="stat-badge badge-cyan">{isSelectedDateToday ? 'Live' : 'Selecionado'}</span>
        </div>
        <div class="stat-value">
          {currentPriceRecord ? `${currentPriceRecord.price.toFixed(2)}` : '--.--'}
          <span class="unit">€/MWh</span>
        </div>
        <div class="stat-footer">
          {#if isSelectedDateToday && currentPriceRecord}
            <span>Período {currentPriceRecord.period} ({periodToTime(currentPriceRecord.period)})</span>
          {:else}
            <span>Período atual indisponível</span>
          {/if}
        </div>
      </div>

      <!-- Stat 2: Resumo do Dia -->
      <div class="stat-card">
        <div class="card-glow glow-amber"></div>
        <div class="stat-header">
          <span class="stat-label">Resumo do Dia</span>
          <span class="stat-badge badge-amber">Métricas</span>
        </div>
        <div class="metrics-list">
          <div class="metric-item">
            <span class="metric-label">
              <span class="indicator-dot dot-amber"></span>
              Preço Médio
            </span>
            <span class="metric-value font-mono">
              {averagePrice.toFixed(2)} <span class="unit">€/MWh</span>
            </span>
          </div>

          <div class="metric-item">
            <span class="metric-label">
              <span class="indicator-dot dot-green"></span>
              Preço Mínimo
            </span>
            <div class="metric-value-container">
              <span class="metric-value text-green font-mono">
                {minPriceRecord ? minPriceRecord.price.toFixed(2) : '0.00'} <span class="unit">€/MWh</span>
              </span>
              {#if minPriceRecord}
                <span class="metric-meta">Período {minPriceRecord.period} ({periodToTime(minPriceRecord.period)})</span>
              {/if}
            </div>
          </div>

          <div class="metric-item">
            <span class="metric-label">
              <span class="indicator-dot dot-rose"></span>
              Preço Máximo
            </span>
            <div class="metric-value-container">
              <span class="metric-value text-rose font-mono">
                {maxPriceRecord ? maxPriceRecord.price.toFixed(2) : '0.00'} <span class="unit">€/MWh</span>
              </span>
              {#if maxPriceRecord}
                <span class="metric-meta">Período {maxPriceRecord.period} ({periodToTime(maxPriceRecord.period)})</span>
              {/if}
            </div>
          </div>
        </div>
      </div>
    </section>

    <!-- Main Visualizations Grid -->
    <section class="main-layout">
      <!-- Chart Card -->
      <div class="panel chart-panel">
        <div class="panel-header chart-header-row">
          <div>
            <h2>Curva de Preço Intradiária</h2>
            <p class="panel-desc">
              {#if chartViewMode === 'hourly'}
                Evolução do preço médio horário ao longo das 24 horas
              {:else}
                Evolução do preço em intervalos de 15 minutos ao longo das 24 horas
              {/if}
            </p>
          </div>
          
          <!-- Granularity Toggle -->
          <div class="segmented-control control-small">
            <button 
              class="control-btn btn-small" 
              class:active={chartViewMode === 'hourly'} 
              onclick={() => chartViewMode = 'hourly'}
            >
              Hora a Hora
            </button>
            <button 
              class="control-btn btn-small" 
              class:active={chartViewMode === 'quarterly'} 
              onclick={() => chartViewMode = 'quarterly'}
            >
              15 Minutos
            </button>
          </div>
        </div>
        <div class="chart-container" bind:this={chartElement}></div>
      </div>

      <!-- Table Card -->
      <div class="panel table-panel">
        <div class="panel-header">
          <h2>Lista de Períodos</h2>
          <p class="panel-desc">Preço detalhado por quarto de hora</p>
        </div>
        <div class="table-scroll-container">
          <table class="prices-table">
            <thead>
              <tr>
                <th>Período</th>
                <th>Hora de Início</th>
                <th class="text-right">Preço</th>
                <th class="text-center">Estado</th>
              </tr>
            </thead>
            <tbody>
              {#each prices as p}
                <tr class:current-row={isSelectedDateToday && p.period === currentPeriod}>
                  <td>{p.period}</td>
                  <td>{periodToTime(p.period)}</td>
                  <td class="text-right font-mono font-bold">{p.price.toFixed(2)} €/MWh</td>
                  <td class="text-center">
                    <span class="badge badge-price {getPriceClass(p.price)}">
                      {getPriceLabel(p.price)}
                    </span>
                  </td>
                </tr>
              {/each}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  {/if}

  <!-- Footer Information -->
  <footer class="dashboard-footer">
    {#if apiStatus}
      <div class="status-indicator">
        <span class="status-dot"></span>
        <span>Banco de Dados: <strong>{apiStatus.database.totalRecords}</strong> registos</span>
        <span class="separator">|</span>
        <span>Período Disponível: <strong>{apiStatus.database.minDate}</strong> a <strong>{apiStatus.database.maxDate}</strong></span>
      </div>
    {/if}
    <div class="credits">
      Desenvolvido para Coolify • Fonte de dados oficial OMIE
    </div>
  </footer>
</main>

<style>
  :global(body) {
    margin: 0;
    font-family: 'Outfit', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    background-color: #0b0f19;
    color: #e2e8f0;
    -webkit-font-smoothing: antialiased;
    overflow-x: hidden;
  }

  .dashboard-container {
    max-width: 1400px;
    margin: 0 auto;
    padding: 2rem;
    box-sizing: border-box;
    display: flex;
    flex-direction: column;
    gap: 2rem;
    min-height: 100vh;
  }

  /* Header Styles */
  .dashboard-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    flex-wrap: wrap;
    gap: 1.5rem;
    padding-bottom: 1.5rem;
    border-bottom: 1px solid rgba(255, 255, 255, 0.06);
  }

  .brand {
    display: flex;
    align-items: center;
    gap: 1rem;
  }

  .logo-icon {
    font-size: 2.2rem;
    background: linear-gradient(135deg, #00f2fe 0%, #4facfe 100%);
    -webkit-background-clip: text;
    -webkit-text-fill-color: transparent;
    filter: drop-shadow(0 0 8px rgba(0, 242, 254, 0.4));
  }

  .brand h1 {
    margin: 0;
    font-size: 1.8rem;
    font-weight: 800;
    letter-spacing: -0.025em;
    background: linear-gradient(to right, #ffffff, #94a3b8);
    -webkit-background-clip: text;
    -webkit-text-fill-color: transparent;
  }

  .subtitle {
    margin: 0.1rem 0 0 0;
    font-size: 0.9rem;
    color: #64748b;
    font-weight: 400;
  }

  .controls-panel {
    display: flex;
    align-items: center;
    gap: 1rem;
    flex-wrap: wrap;
  }

  /* Segmented Buttons */
  .segmented-control {
    background: rgba(30, 41, 59, 0.7);
    padding: 0.25rem;
    border-radius: 12px;
    display: flex;
    border: 1px solid rgba(255, 255, 255, 0.05);
  }

  .chart-header-row {
    display: flex;
    justify-content: space-between;
    align-items: center;
    flex-wrap: wrap;
    gap: 1rem;
  }

  .control-small {
    padding: 0.15rem;
    border-radius: 8px;
  }

  .btn-small {
    padding: 0.35rem 0.75rem;
    border-radius: 6px;
    font-size: 0.8rem;
  }

  .control-btn {
    background: transparent;
    border: none;
    color: #94a3b8;
    padding: 0.5rem 1.25rem;
    border-radius: 10px;
    font-weight: 600;
    font-size: 0.9rem;
    cursor: pointer;
    transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
  }

  .control-btn:hover {
    color: #ffffff;
  }

  .control-btn.active {
    background: #00f2fe;
    color: #0f172a;
    box-shadow: 0 4px 12px rgba(0, 242, 254, 0.2);
  }

  /* Date Input */
  .date-input-wrapper input {
    background: rgba(30, 41, 59, 0.7);
    border: 1px solid rgba(255, 255, 255, 0.08);
    color: #e2e8f0;
    padding: 0.5rem 1rem;
    border-radius: 12px;
    font-family: inherit;
    font-size: 0.9rem;
    outline: none;
    transition: all 0.2s;
  }

  .date-input-wrapper input:focus {
    border-color: #00f2fe;
    box-shadow: 0 0 0 2px rgba(0, 242, 254, 0.15);
  }

  /* Stats Grid */
  .stats-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
    gap: 1.5rem;
  }

  .stat-card {
    position: relative;
    background: rgba(20, 26, 40, 0.6);
    border: 1px solid rgba(255, 255, 255, 0.06);
    border-radius: 18px;
    padding: 1.5rem;
    overflow: hidden;
    backdrop-filter: blur(16px);
    transition: transform 0.2s, box-shadow 0.2s;
  }

  .stat-card:hover {
    transform: translateY(-4px);
    box-shadow: 0 12px 24px -10px rgba(0, 0, 0, 0.4);
    border-color: rgba(255, 255, 255, 0.12);
  }

  .card-glow {
    position: absolute;
    top: -50px;
    right: -50px;
    width: 120px;
    height: 120px;
    border-radius: 50%;
    filter: blur(50px);
    opacity: 0.12;
    pointer-events: none;
  }

  .glow-cyan { background: #00f2fe; }
  .glow-amber { background: #fbbf24; }
  .glow-green { background: #10b981; }
  .glow-rose { background: #f43f5e; }

  .stat-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 0.75rem;
  }

  .stat-label {
    font-size: 0.85rem;
    font-weight: 600;
    color: #64748b;
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }

  .stat-badge {
    font-size: 0.75rem;
    font-weight: 700;
    padding: 0.15rem 0.5rem;
    border-radius: 6px;
    text-transform: uppercase;
  }

  .badge-cyan { background: rgba(0, 242, 254, 0.1); color: #00f2fe; }
  .badge-amber { background: rgba(251, 191, 36, 0.1); color: #fbbf24; }
  .badge-green { background: rgba(16, 185, 129, 0.1); color: #10b981; }
  .badge-rose { background: rgba(244, 63, 94, 0.1); color: #f43f5e; }

  .stat-value {
    font-size: 2.2rem;
    font-weight: 800;
    line-height: 1.1;
    display: flex;
    align-items: baseline;
    gap: 0.3rem;
  }

  .stat-value .unit {
    font-size: 1rem;
    font-weight: 500;
    color: #475569;
  }

  .stat-footer {
    margin-top: 1rem;
    font-size: 0.8rem;
    color: #64748b;
    border-top: 1px solid rgba(255, 255, 255, 0.04);
    padding-top: 0.75rem;
  }

  .text-green { color: #10b981; }
  .text-rose { color: #f43f5e; }

  .highlight-pulse {
    animation: stat-pulse 3s infinite alternate;
  }

  /* Metrics List in combined card */
  .metrics-list {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
    margin-top: 0.5rem;
  }

  .metric-item {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding-bottom: 0.75rem;
    border-bottom: 1px solid rgba(255, 255, 255, 0.04);
  }

  .metric-item:last-child {
    border-bottom: none;
    padding-bottom: 0;
  }

  .metric-label {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    font-size: 0.9rem;
    color: #94a3b8;
    font-weight: 500;
  }

  .indicator-dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    display: inline-block;
  }

  .dot-amber {
    background: #fbbf24;
    box-shadow: 0 0 6px #fbbf24;
  }

  .dot-green {
    background: #10b981;
    box-shadow: 0 0 6px #10b981;
  }

  .dot-rose {
    background: #f43f5e;
    box-shadow: 0 0 6px #f43f5e;
  }

  .metric-value-container {
    display: flex;
    flex-direction: column;
    align-items: flex-end;
  }

  .metric-value {
    font-size: 1.15rem;
    font-weight: 700;
  }

  .metric-value .unit {
    font-size: 0.8rem;
    font-weight: 500;
    color: #475569;
  }

  .metric-meta {
    font-size: 0.75rem;
    color: #64748b;
  }

  @keyframes stat-pulse {
    0% { border-color: rgba(255, 255, 255, 0.06); }
    100% { border-color: rgba(0, 242, 254, 0.25); }
  }

  /* Main Layout */
  .main-layout {
    display: grid;
    grid-template-columns: 1fr;
    gap: 1.5rem;
  }

  /* Panels */
  .panel {
    background: rgba(20, 26, 40, 0.5);
    border: 1px solid rgba(255, 255, 255, 0.06);
    border-radius: 20px;
    padding: 1.5rem;
    backdrop-filter: blur(12px);
    display: flex;
    flex-direction: column;
    gap: 1.25rem;
  }

  .panel-header {
    border-bottom: 1px solid rgba(255, 255, 255, 0.04);
    padding-bottom: 0.75rem;
  }

  .panel-header h2 {
    margin: 0;
    font-size: 1.3rem;
    font-weight: 700;
  }

  .panel-desc {
    margin: 0.2rem 0 0 0;
    font-size: 0.85rem;
    color: #64748b;
  }

  /* Table panel styles */
  .table-scroll-container {
    max-height: 400px;
    overflow-y: auto;
    border-radius: 12px;
    border: 1px solid rgba(255, 255, 255, 0.04);
  }

  /* Custom scrollbar */
  .table-scroll-container::-webkit-scrollbar {
    width: 6px;
  }
  .table-scroll-container::-webkit-scrollbar-track {
    background: rgba(0, 0, 0, 0.1);
  }
  .table-scroll-container::-webkit-scrollbar-thumb {
    background: rgba(255, 255, 255, 0.1);
    border-radius: 3px;
  }
  .table-scroll-container::-webkit-scrollbar-thumb:hover {
    background: rgba(255, 255, 255, 0.2);
  }

  .prices-table {
    width: 100%;
    border-collapse: collapse;
    font-size: 0.9rem;
  }

  .prices-table th {
    position: sticky;
    top: 0;
    background: #0f172a;
    padding: 0.75rem 1rem;
    font-weight: 600;
    text-align: left;
    color: #64748b;
    border-bottom: 1px solid rgba(255, 255, 255, 0.08);
  }

  .prices-table td {
    padding: 0.75rem 1rem;
    border-bottom: 1px solid rgba(255, 255, 255, 0.03);
    color: #cbd5e1;
  }

  .prices-table tbody tr {
    transition: background 0.15s;
  }

  .prices-table tbody tr:hover {
    background: rgba(255, 255, 255, 0.02);
  }

  .prices-table tbody tr.current-row {
    background: rgba(0, 242, 254, 0.05);
    box-shadow: inset 2px 0 0 #00f2fe;
  }

  .font-mono {
    font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  }

  .font-bold {
    font-weight: 700;
  }

  .text-right { text-align: right; }
  .text-center { text-align: center; }

  /* Table Badges */
  .badge-price {
    font-size: 0.75rem;
    font-weight: 600;
    padding: 0.2rem 0.5rem;
    border-radius: 9999px;
    display: inline-block;
  }

  .badge-price.cheap {
    background: rgba(16, 185, 129, 0.12);
    color: #34d399;
    border: 1px solid rgba(16, 185, 129, 0.2);
  }

  .badge-price.normal {
    background: rgba(71, 85, 105, 0.2);
    color: #94a3b8;
    border: 1px solid rgba(71, 85, 105, 0.3);
  }

  .badge-price.expensive {
    background: rgba(244, 63, 94, 0.12);
    color: #fb7185;
    border: 1px solid rgba(244, 63, 94, 0.2);
  }

  /* Alerts */
  .alert {
    padding: 1.25rem;
    border-radius: 16px;
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 1.5rem;
  }

  .alert-content {
    display: flex;
    gap: 1rem;
    align-items: center;
  }

  .alert-icon {
    font-size: 1.75rem;
  }

  .alert h3 {
    margin: 0;
    font-size: 1rem;
    font-weight: 700;
  }

  .alert p {
    margin: 0.2rem 0 0 0;
    font-size: 0.85rem;
    color: rgba(255, 255, 255, 0.7);
  }

  .alert-error {
    background: rgba(244, 63, 94, 0.12);
    border: 1px solid rgba(244, 63, 94, 0.25);
    color: #fb7185;
  }

  .alert-info {
    background: rgba(30, 41, 59, 0.5);
    border: 1px solid rgba(255, 255, 255, 0.08);
    color: #94a3b8;
  }

  .btn {
    border: none;
    padding: 0.5rem 1.25rem;
    border-radius: 8px;
    font-weight: 600;
    font-size: 0.85rem;
    cursor: pointer;
    transition: all 0.2s;
  }

  .btn-retry {
    background: #f43f5e;
    color: #ffffff;
  }

  .btn-retry:hover {
    background: #e11d48;
    box-shadow: 0 4px 12px rgba(244, 63, 94, 0.3);
  }

  /* Loader */
  .loader-overlay {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 1rem;
    padding: 4rem 0;
  }

  .spinner {
    width: 40px;
    height: 40px;
    border: 4px solid rgba(255, 255, 255, 0.08);
    border-top: 4px solid #00f2fe;
    border-radius: 50%;
    animation: spin 1s linear infinite;
    filter: drop-shadow(0 0 6px rgba(0, 242, 254, 0.4));
  }

  @keyframes spin {
    0% { transform: rotate(0deg); }
    100% { transform: rotate(360deg); }
  }

  /* Footer */
  .dashboard-footer {
    display: flex;
    justify-content: space-between;
    align-items: center;
    flex-wrap: wrap;
    gap: 1.5rem;
    margin-top: auto;
    padding-top: 1.5rem;
    border-top: 1px solid rgba(255, 255, 255, 0.06);
    font-size: 0.85rem;
    color: #475569;
  }

  .status-indicator {
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }

  .status-dot {
    width: 8px;
    height: 8px;
    background: #10b981;
    border-radius: 50%;
    display: inline-block;
    box-shadow: 0 0 8px #10b981;
  }

  .separator {
    color: rgba(255, 255, 255, 0.08);
  }

  .credits {
    font-weight: 500;
  }

  @media (max-width: 640px) {
    .dashboard-container {
      padding: 1rem;
    }
    
    .dashboard-header {
      flex-direction: column;
      align-items: flex-start;
    }
    
    .controls-panel {
      width: 100%;
      justify-content: space-between;
    }

    .segmented-control, .date-input-wrapper {
      width: 100%;
    }

    .segmented-control button, .date-input-wrapper input {
      flex: 1;
      text-align: center;
    }

    .dashboard-footer {
      flex-direction: column;
      align-items: flex-start;
      gap: 0.75rem;
    }
  }
</style>
