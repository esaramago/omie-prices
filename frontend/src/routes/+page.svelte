<script>
  import { onMount } from 'svelte';

  function detectCountry() {
    if (typeof window === 'undefined') return 'PT';
    try {
      const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
      if (tz) {
        if (tz.includes('Lisbon') || tz.includes('Azores') || tz.includes('Madeira')) {
          return 'PT';
        }
        if (tz.includes('Madrid') || tz.includes('Ceuta') || tz.includes('Canary')) {
          return 'ES';
        }
      }
    } catch (e) {
      // Ignore timezone read errors
    }
    try {
      const lang = navigator.language || (navigator.languages && navigator.languages[0]);
      if (lang) {
        if (lang.startsWith('pt')) return 'PT';
        if (lang.startsWith('es')) return 'ES';
      }
    } catch (e) {
      // Ignore language read errors
    }
    return 'PT';
  }

  // State using Svelte 5 Runes
  let selectedDate = $state(new Date().toISOString().split('T')[0]);
  let selectedCountry = $state(
    (typeof localStorage !== 'undefined' && localStorage.getItem('selectedCountry')) || 
    detectCountry()
  );
  let selectedProvider = $state(
    (typeof localStorage !== 'undefined' && localStorage.getItem('selectedProvider')) || 
    'OMIE'
  );
  let prices = $state([]);
  let loading = $state(true);
  let error = $state(null);
  let apiStatus = $state(null);
  
  let chartElement = $state(null);
  let chart = null;
  let chartPromise = null;

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

  let currentPeriod = $state(getCurrentPeriod());
  const currentHour = $derived(Math.floor((currentPeriod - 1) / 4));

  const processedPrices = $derived.by(() => {
    if (selectedProvider === 'Coopérnico') {
      const k = 0.009;
      const GO = 0.001;
      const FP = 0.15;
      const TAR = 0.0607; // Tarifa de Acesso às Redes BTN Simples (2026)
      return prices.map(p => {
        const omieKwh = p.price / 1000;
        const coopernicoKwh = ((omieKwh + k) * (1 + FP)) + GO + TAR;
        return {
          ...p,
          price: coopernicoKwh
        };
      });
    }
    return prices;
  });

  const priceUnit = $derived(selectedProvider === 'OMIE' ? '€/MWh' : '€/kWh');
  const priceDecimals = $derived(selectedProvider === 'OMIE' ? 2 : 4);
  const chartDecimals = $derived(selectedProvider === 'OMIE' ? 2 : 2);
  const labelDecimals = $derived(selectedProvider === 'OMIE' ? 1 : 2);

  function formatDataLabel(value, opts) {
    if (typeof value !== 'number') return '';
    const isQuarterly = chartViewMode === 'quarterly';
    
    // Check if this data point is the active/current one
    const isCurrent = isSelectedDateToday && (
      (isQuarterly && opts.dataPointIndex === (currentPeriod - 1)) ||
      (!isQuarterly && opts.dataPointIndex === currentHour)
    );

    if (isQuarterly) {
      // In quarterly mode, show every 4th label OR the current period's label
      if (isCurrent || opts.dataPointIndex % 4 === 0) {
        return `${value.toFixed(labelDecimals)}€`;
      }
      return '';
    }
    return `${value.toFixed(labelDecimals)}€`;
  }

  // Derived state: aggregate 15-minute periods into hourly averages for the chart
  const hourlyPrices = $derived.by(() => {
    if (processedPrices.length === 0) return [];
    const hourly = [];
    for (let h = 0; h < 24; h++) {
      const hourPeriods = processedPrices.filter(p => Math.floor((p.period - 1) / 4) === h);
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

  // Derived Values (using processed prices)
  const averagePrice = $derived(
    processedPrices.length > 0
      ? processedPrices.reduce((sum, p) => sum + p.price, 0) / processedPrices.length
      : 0
  );

  const minPriceRecord = $derived(
    processedPrices.length > 0
      ? processedPrices.reduce((min, p) => (p.price < min.price ? p : min), processedPrices[0])
      : null
  );

  const maxPriceRecord = $derived(
    processedPrices.length > 0
      ? processedPrices.reduce((max, p) => (p.price > max.price ? p : max), processedPrices[0])
      : null
  );

  const currentPriceRecord = $derived(
    processedPrices.length > 0 ? processedPrices.find((p) => p.period === currentPeriod) : null
  );

  const isSelectedDateToday = $derived(
    selectedDate === new Date().toISOString().split('T')[0]
  );

  const isWeekend = $derived.by(() => {
    if (!selectedDate) return false;
    const dateObj = new Date(selectedDate);
    const day = dateObj.getDay();
    return day === 0 || day === 6; // 0 = Sunday, 6 = Saturday
  });

  const lowThresholdPercent = $derived(isWeekend ? 0.92 : 0.8);
  const highThresholdPercent = $derived(isWeekend ? 1.08 : 1.2);

  const historicalAverage = $derived.by(() => {
    if (!apiStatus || !apiStatus.database || !apiStatus.database.historicalAverages) {
      return null;
    }
    const countryAverages = apiStatus.database.historicalAverages[selectedCountry];
    if (!countryAverages) return null;
    
    const baseAvg = isWeekend ? countryAverages.weekend : countryAverages.weekday;
    
    // Convert to Coopérnico if necessary
    if (selectedProvider === 'Coopérnico') {
      const k = 0.009;
      const GO = 0.001;
      const FP = 0.15;
      const TAR = 0.0607;
      const omieKwh = baseAvg / 1000;
      return ((omieKwh + k) * (1 + FP)) + GO + TAR;
    }
    return baseAvg;
  });

  const comparisonAverage = $derived(
    historicalAverage !== null ? historicalAverage : averagePrice
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

  // Save selected provider to localStorage when it changes
  $effect(() => {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem('selectedProvider', selectedProvider);
    }
  });

  // Save selected country to localStorage when it changes
  $effect(() => {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem('selectedCountry', selectedCountry);
    }
  });

  onMount(() => {
    loadStatus();
    // Refresh API status and current period calculations every 5 minutes
    const interval = setInterval(() => {
      loadStatus();
      currentPeriod = getCurrentPeriod();
    }, 5 * 60 * 1000);
    return () => {
      clearInterval(interval);
      if (chart) {
        chart.destroy();
        chart = null;
      }
      chartPromise = null;
    };
  });

  // Chart Rendering effect
  $effect(() => {
    if (processedPrices.length > 0 && chartElement) {
      const displayData = chartViewMode === 'hourly' ? hourlyPrices : processedPrices.map(p => ({
        price: p.price,
        time: periodToTime(p.period)
      }));
      const seriesData = displayData.map((p) => p.price);
      
      const activeIdx = isSelectedDateToday 
        ? (chartViewMode === 'hourly' ? currentHour : currentPeriod - 1)
        : -1;

      const categories = displayData.map((p, idx) => {
        if (isSelectedDateToday && idx === activeIdx) {
          return `${p.time} (Atual)`;
        }
        return p.time;
      });

      const colors = displayData.map((p) => {
        const price = p.price;
        if (price < comparisonAverage * lowThresholdPercent) return '#10b981'; // Verde (Emerald-500)
        if (price < comparisonAverage) return '#eab308';                       // Amarelo (Yellow-500)
        if (price < comparisonAverage * highThresholdPercent) return '#f97316'; // Laranja (Orange-500)
        return '#ef4444';                                                 // Vermelho (Red-500)
      });

      const gradientToColors = displayData.map((p) => {
        const price = p.price;
        if (price < comparisonAverage * lowThresholdPercent) return '#34d399'; // Verde Claro (Emerald-400)
        if (price < comparisonAverage) return '#facc15';                       // Amarelo Claro (Yellow-400)
        if (price < comparisonAverage * highThresholdPercent) return '#fb923c'; // Laranja Claro (Orange-400)
        return '#f87171';                                                 // Vermelho Claro (Red-400)
      });

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
            borderRadiusApplication: 'end',
            distributed: true,
            dataLabels: {
              position: 'top'
            }
          }
        },
        legend: {
          show: false
        },
        dataLabels: {
          enabled: true,
          style: {
            fontSize: '11px',
            fontFamily: 'Outfit, sans-serif',
            fontWeight: '600',
            colors: ['#ffffff']
          },
          background: {
            enabled: true,
            foreColor: '#0b0f19',
            padding: 4,
            borderRadius: 4,
            borderWidth: 0,
            opacity: 0.9
          },
          offsetY: -12,
          formatter: formatDataLabel
        },
        colors: colors,
        stroke: {
          show: isSelectedDateToday && activeIdx !== -1,
          width: 2,
          colors: displayData.map((p, idx) => idx === activeIdx ? '#ffffff' : 'transparent')
        },
        fill: {
          type: 'gradient',
          gradient: {
            shade: 'dark',
            type: 'vertical',
            shadeIntensity: 0.5,
            gradientToColors: gradientToColors,
            inverseColors: false,
            opacityFrom: 0.85,
            opacityTo: 0.55,
            stops: [0, 100]
          }
        },
        series: [
          {
            name: `Preço (${selectedCountry}) - ${selectedProvider}`,
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
            style: { colors: '#94a3b8', fontSize: '11px' },
            formatter: (value) => {
              if (chartViewMode === 'quarterly') {
                const valStr = String(value || '');
                return valStr && (valStr.endsWith(':00') || valStr.includes('(Atual)')) ? valStr : '';
              }
              return value;
            }
          },
          axisBorder: { show: false },
          axisTicks: { show: false }
        },
        yaxis: {
          labels: {
            style: { colors: '#94a3b8' },
            formatter: (value) => typeof value === 'number' ? `${value.toFixed(chartDecimals)} ${priceUnit}` : value
          }
        },
        grid: {
          borderColor: 'rgba(255, 255, 255, 0.06)',
          strokeDashArray: 4
        },
        tooltip: {
          theme: 'dark',
          x: { show: true },
          y: { formatter: (value) => `${value.toFixed(priceDecimals)} ${priceUnit}` }
        },
        responsive: [
          {
            breakpoint: 640,
            options: {
              plotOptions: {
                bar: {
                  horizontal: true,
                  barHeight: '70%',
                  borderRadius: 4,
                  borderRadiusApplication: 'end',
                  distributed: true,
                  dataLabels: {
                    position: 'top'
                  }
                }
              },
              chart: {
                height: chartViewMode === 'hourly' ? 650 : 1800
              },
              dataLabels: {
                offsetX: 8,
                offsetY: 0,
                style: {
                  fontSize: '11px'
                }
              },
              fill: {
                type: 'gradient',
                gradient: {
                  type: 'horizontal',
                  gradientToColors: gradientToColors
                }
              },
              xaxis: {
                labels: {
                  rotate: 0,
                  style: { colors: '#94a3b8', fontSize: '11px' },
                  formatter: (value) => typeof value === 'number' ? `${value.toFixed(chartDecimals)} ${priceUnit}` : value
                }
              },
              yaxis: {
                labels: {
                  style: { colors: '#94a3b8', fontSize: '11px' },
                  formatter: (value) => {
                    if (chartViewMode === 'quarterly') {
                      const valStr = String(value || '');
                      return valStr && (valStr.endsWith(':00') || valStr.includes('(Atual)')) ? valStr : '';
                    }
                    return value;
                  }
                }
              }
            }
          }
        ]
      };

      if (chart) {
        chart.updateOptions(options);
      } else if (!chartPromise) {
        chartPromise = import('apexcharts').then(({ default: ApexCharts }) => {
          chart = new ApexCharts(chartElement, options);
          chart.render();
          return chart;
        });
      } else {
        chartPromise.then((instance) => {
          instance.updateOptions(options);
        });
      }
    } else {
      if (chart) {
        chart.destroy();
        chart = null;
      }
      chartPromise = null;
    }
  });

  function getPriceClass(price) {
    if (price < comparisonAverage * lowThresholdPercent) return 'cheap';
    if (price < comparisonAverage) return 'moderate-cheap';
    if (price < comparisonAverage * highThresholdPercent) return 'moderate-expensive';
    return 'expensive';
  }

  function getPriceLabel(price) {
    if (price < comparisonAverage * lowThresholdPercent) return 'Barato';
    if (price < comparisonAverage) return 'Moderado';
    if (price < comparisonAverage * highThresholdPercent) return 'Caro';
    return 'Muito caro';
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

      <!-- Provider Select -->
      <div class="select-input-wrapper">
        <select 
          id="provider-select"
          bind:value={selectedProvider}
        >
          <option value="OMIE">OMIE (Grossista)</option>
          <option value="Coopérnico">Coopérnico</option>
        </select>
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
  {:else if processedPrices.length === 0 && !error}
    <section class="alert alert-info">
      <span class="alert-icon">ℹ️</span>
      <div>
        <h3>Sem dados disponíveis</h3>
        <p>Não foram encontrados preços para a data selecionada ({selectedDate}). O mercado da OMIE pode ainda não ter publicado os preços para amanhã.</p>
      </div>
    </section>
  {:else if processedPrices.length > 0}


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

      <!-- Bottom Layout: Table and Summary -->
      <div class="details-grid">

        <!-- Summary Panel -->
        <div class="panel summary-panel">
          <div class="card-glow glow-amber"></div>
          <div class="panel-header">
            <h2>Resumo do Dia</h2>
            <p class="panel-desc">Principais métricas de preços de hoje</p>
          </div>
          <div class="metrics-list">
            <div class="metric-item">
              <span class="metric-label">
                <span class="indicator-dot dot-cyan"></span>
                Preço Atual
                {#if isSelectedDateToday}
                  <span class="stat-badge badge-cyan" style="font-size: 0.65rem; padding: 0.1rem 0.3rem; margin-left: 0.25rem;">Live</span>
                {/if}
              </span>
              <div class="metric-value-container">
                <span class="metric-value text-cyan font-mono">
                  {isSelectedDateToday && currentPriceRecord ? currentPriceRecord.price.toFixed(priceDecimals) : '--.--'} <span class="unit">{priceUnit}</span>
                </span>
                {#if isSelectedDateToday && currentPriceRecord}
                  <span class="metric-meta">Período {currentPriceRecord.period} ({periodToTime(currentPriceRecord.period)})</span>
                {:else}
                  <span class="metric-meta">Período atual indisponível</span>
                {/if}
              </div>
            </div>

            <div class="metric-item">
              <span class="metric-label">
                <span class="indicator-dot dot-amber"></span>
                Preço Médio
              </span>
              <span class="metric-value font-mono">
                {averagePrice.toFixed(priceDecimals)} <span class="unit">{priceUnit}</span>
              </span>
            </div>

            <div class="metric-item">
              <span class="metric-label">
                <span class="indicator-dot dot-green"></span>
                Preço Mínimo
              </span>
              <div class="metric-value-container">
                <span class="metric-value text-green font-mono">
                  {minPriceRecord ? minPriceRecord.price.toFixed(priceDecimals) : '0.00'} <span class="unit">{priceUnit}</span>
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
                  {maxPriceRecord ? maxPriceRecord.price.toFixed(priceDecimals) : '0.00'} <span class="unit">{priceUnit}</span>
                </span>
                {#if maxPriceRecord}
                  <span class="metric-meta">Período {maxPriceRecord.period} ({periodToTime(maxPriceRecord.period)})</span>
                {/if}
              </div>
            </div>

            {#if historicalAverage !== null}
              <div class="metric-item">
                <span class="metric-label">
                  <span class="indicator-dot" style="background: #38bdf8; box-shadow: 0 0 6px #38bdf8;"></span>
                  Média Histórica ({isWeekend ? 'Fim de Semana' : 'Dia Útil'})
                </span>
                <span class="metric-value font-mono" style="color: #38bdf8;">
                  {historicalAverage.toFixed(priceDecimals)} <span class="unit">{priceUnit}</span>
                </span>
              </div>
            {/if}
          </div>
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
                {#each processedPrices as p}
                  <tr class:current-row={isSelectedDateToday && p.period === currentPeriod}>
                    <td>{p.period}</td>
                    <td>{periodToTime(p.period)} {isSelectedDateToday && p.period === currentPeriod ? '(Atual)' : ''}</td>
                    <td class="text-right font-mono font-bold">{p.price.toFixed(priceDecimals)} {priceUnit}</td>
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
      </div>
    </section>
  {/if}

  <!-- Footer Information -->
  <footer class="dashboard-footer">
    {#if apiStatus}
      <div class="status-indicator">
        <span class="status-dot"></span>
        <span>Período Disponível: <strong>{apiStatus.database.minDate}</strong> a <strong>{apiStatus.database.maxDate}</strong></span>
      </div>
    {/if}
    <div class="credits">
      Desenvolvido por Emanuel Saramago • <a href="https://github.com/esaramago/omie-prices" target="_blank" rel="noopener noreferrer">Repositório GitHub</a> • Fonte de dados oficial OMIE
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

  /* Select Input */
  .select-input-wrapper select {
    background: rgba(30, 41, 59, 0.7);
    border: 1px solid rgba(255, 255, 255, 0.08);
    color: #e2e8f0;
    padding: 0.5rem 2.25rem 0.5rem 1rem;
    border-radius: 12px;
    font-family: inherit;
    font-size: 0.9rem;
    outline: none;
    transition: all 0.2s;
    appearance: none;
    cursor: pointer;
    background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' fill='none' viewBox='0 0 24 24' stroke='%2394a3b8'%3E%3Cpath stroke-linecap='round' stroke-linejoin='round' stroke-width='2' d='M19 9l-7 7-7-7'/%3E%3C/svg%3E");
    background-repeat: no-repeat;
    background-position: right 0.75rem center;
    background-size: 1rem;
  }

  .select-input-wrapper select:focus {
    border-color: #00f2fe;
    box-shadow: 0 0 0 2px rgba(0, 242, 254, 0.15);
  }

  .select-input-wrapper select option {
    background-color: #0b0f19;
    color: #e2e8f0;
  }

  /* Stats Grid */
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

  .stat-badge {
    font-size: 0.75rem;
    font-weight: 700;
    padding: 0.15rem 0.5rem;
    border-radius: 6px;
    text-transform: uppercase;
  }

  .badge-cyan { background: rgba(0, 242, 254, 0.1); color: #00f2fe; }

  .text-green { color: #10b981; }
  .text-rose { color: #f43f5e; }
  .text-cyan { color: #00f2fe; }


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

  .dot-cyan {
    background: #00f2fe;
    box-shadow: 0 0 6px #00f2fe;
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


  /* Main Layout */
  .main-layout {
    display: grid;
    grid-template-columns: 1fr;
    gap: 1.5rem;
  }

  /* Details Grid (Table & Summary side-by-side on desktop) */
  .details-grid {
    display: flex;
    gap: 1.5rem;
    > * {
      flex: 1;
    }
  }

  .summary-panel {
    position: relative;
    overflow: hidden;
    transition: transform 0.2s, box-shadow 0.2s, border-color 0.2s;
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

  .badge-price.moderate-cheap {
    background: rgba(234, 179, 8, 0.12);
    color: #facc15;
    border: 1px solid rgba(234, 179, 8, 0.2);
  }

  .badge-price.moderate-expensive {
    background: rgba(249, 115, 22, 0.12);
    color: #fb923c;
    border: 1px solid rgba(249, 115, 22, 0.2);
  }

  .badge-price.expensive {
    background: rgba(239, 68, 68, 0.12);
    color: #f87171;
    border: 1px solid rgba(239, 68, 68, 0.2);
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
    > a {
      color: inherit;
    }
  }

  @media (max-width: 640px) {
    .dashboard-container {
      padding: 1rem;
    }
    
    .dashboard-header {
      flex-direction: column;
      align-items: flex-start;
    }

    .chart-header-row {
      flex-direction: column;
      align-items: start;
    }

    .controls-panel {
      width: 100%;
      justify-content: space-between;
    }
    .segmented-control button, .date-input-wrapper input, .select-input-wrapper select {
      flex: 1;
      text-align: center;
    }

    .dashboard-footer {
      flex-direction: column;
      align-items: flex-start;
      gap: 0.75rem;
    }
  }

  @media (max-width: 500px) {
    .segmented-control,
    .date-input-wrapper,
    .select-input-wrapper {
      width: 100%;
    }
    .select-input-wrapper select {
      width: 100%;
    }
  }
</style>
