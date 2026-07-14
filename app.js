// App state variables
let appData = null;
let startMonthIdx = 0;
let endMonthIdx = 6; // Default to July (since current data is up to July)
let currentView = 'global'; // 'global' or sheetName (e.g., 'HSI')
let activeUnitSheet = null;

// Chart.js chart instances to prevent canvas reuse errors
let globalCompareChart = null;
let globalDistChart = null;
let unitMonthlyChart = null;
let unitConsumptionChart = null;

// Month definitions in Portuguese
const monthNames = [
    'Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
    'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'
];
const shortMonthNames = [
    'Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun',
    'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'
];

// Special unit notices
const unitNotices = {
    'CCS 02': 'Obs.: Unidade já fora do Rateio de Guanambi, porém, possui créditos energéticos na unidade, assim, zerando as faturas financeiramente.',
    'Cuidado Continuo': 'Obs.: Unidade já fora do Rateio de Guanambi, porém, possui créditos energéticos na unidade, assim, zerando as faturas financeiramente.',
    'Posto de Coleta': 'Obs.: Unidade já fora do Rateio de Guanambi, porém, possui créditos energéticos na unidade, assim, zerando as faturas financeiramente.'
};

// Formatting helpers
function formatCurrency(value) {
    // Spreadsheet values are negative (costs), we show them as positive for UI clarity
    const absVal = Math.abs(value);
    return absVal.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function formatPercentage(value) {
    // Check if percentage is numeric
    if (isNaN(value) || !isFinite(value)) return '0,0%';
    const pct = value * 100;
    return pct.toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + '%';
}

function formatNumber(value) {
    if (isNaN(value) || value === null) return '0';
    return value.toLocaleString('pt-BR', { maximumFractionDigits: 2 });
}

// Initial initialization
document.addEventListener('DOMContentLoaded', () => {
    if (typeof rawDashboardData !== 'undefined') {
        appData = rawDashboardData;
        
        // Dynamically set default end month to the last month with actual realized values
        detectLastRealizedMonth();
        
        // Build sidebar unit list
        buildSidebarMenu();
        
        // Apply current filters and render UI
        updateDashboard();
    } else {
        console.error('Erro: rawDashboardData não está definido.');
        alert('Não foi possível carregar os dados do dashboard local. Certifique-se de que dashboard_data.js foi carregado com sucesso.');
    }
});

// Detect the last month that has non-zero realized costs across the entire sheet
function detectLastRealizedMonth() {
    let lastMonth = 0;
    const sheets = Object.keys(appData.unidades);
    
    sheets.forEach(sheetName => {
        const unit = appData.unidades[sheetName];
        if (unit.realizado && unit.realizado.length > 0) {
            // Find total realized row
            const totalRow = unit.realizado.find(r => r.label === 'TOTAL GERAL');
            if (totalRow && totalRow.values) {
                for (let m = 11; m >= 0; m--) {
                    if (Math.abs(totalRow.values[m]) > 0.01 && m > lastMonth) {
                        lastMonth = m;
                    }
                }
            }
        }
    });
    
    // Set UI dropdowns and local state
    endMonthIdx = lastMonth;
    document.getElementById('select-end-month').value = endMonthIdx;
    
    // Set appropriate active class to preset button
    updatePresetButtonActive();
}

// Build sidebar items dynamically
function buildSidebarMenu() {
    const listContainer = document.getElementById('sidebar-units');
    listContainer.innerHTML = '';
    
    // We order them by how they appear in the resumo (to preserve the Excel workbook order)
    appData.resumo.forEach(resumoUnit => {
        // Find which sheet corresponds to this unit
        const sheetName = Object.keys(appData.unidades).find(k => appData.unidades[k].unitName === resumoUnit.name);
        
        if (sheetName) {
            const item = document.createElement('div');
            item.className = 'menu-item';
            item.id = `btn-sheet-${sheetName}`;
            item.onclick = () => switchView(sheetName);
            item.innerHTML = `
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
                    <polyline points="14 2 14 8 20 8"></polyline>
                    <line x1="16" y1="13" x2="8" y2="13"></line>
                    <line x1="16" y1="17" x2="8" y2="17"></line>
                    <polyline points="10 9 9 9 8 9"></polyline>
                </svg>
                <span title="${resumoUnit.name}">${sheetName}</span>
            `;
            listContainer.appendChild(item);
        }
    });
}

// Switch between views (Global / Sheet)
function switchView(viewName) {
    currentView = viewName;
    
    // Update active state in sidebar
    document.querySelectorAll('.menu-item').forEach(item => {
        item.classList.remove('active');
    });
    
    if (viewName === 'global') {
        document.getElementById('btn-global').classList.add('active');
        document.getElementById('view-title').textContent = 'Resumo Geral - Energia Elétrica 2026';
        document.getElementById('view-subtitle').textContent = 'Consolidado das despesas e previsões financeiras';
        
        document.getElementById('view-global').classList.add('active');
        document.getElementById('view-unit').classList.remove('active');
        activeUnitSheet = null;
    } else {
        const btn = document.getElementById(`btn-sheet-${viewName}`);
        if (btn) btn.classList.add('active');
        
        const unitName = appData.unidades[viewName].unitName;
        document.getElementById('view-title').textContent = `${viewName} - Detalhamento`;
        document.getElementById('view-subtitle').textContent = unitName;
        
        document.getElementById('view-global').classList.remove('active');
        document.getElementById('view-unit').classList.add('active');
        activeUnitSheet = viewName;
    }
    
    // Force DOM reflow and render appropriate charts/tables
    updateDashboard();
}

// Filter changes callback
function onPeriodChange() {
    startMonthIdx = parseInt(document.getElementById('select-start-month').value);
    endMonthIdx = parseInt(document.getElementById('select-end-month').value);
    
    // Auto-correct if start is greater than end
    if (startMonthIdx > endMonthIdx) {
        endMonthIdx = startMonthIdx;
        document.getElementById('select-end-month').value = endMonthIdx;
    }
    
    updatePresetButtonActive();
    updateDashboard();
}

// Helper to highlight active presets
function updatePresetButtonActive() {
    document.querySelectorAll('.btn-preset').forEach(btn => btn.classList.remove('active'));
    
    if (startMonthIdx === 0 && endMonthIdx === 11) {
        document.getElementById('preset-full').classList.add('active');
    } else if (startMonthIdx === 0 && endMonthIdx === 2) {
        document.getElementById('preset-q1').classList.add('active');
    } else if (startMonthIdx === 3 && endMonthIdx === 5) {
        document.getElementById('preset-q2').classList.add('active');
    } else if (startMonthIdx === 0 && endMonthIdx === 6) {
        document.getElementById('preset-ytd').classList.add('active');
    }
}

// Preset button handlers
function applyPreset(preset) {
    if (preset === 'ytd') {
        startMonthIdx = 0;
        endMonthIdx = 6;
    } else if (preset === 'q1') {
        startMonthIdx = 0;
        endMonthIdx = 2;
    } else if (preset === 'q2') {
        startMonthIdx = 3;
        endMonthIdx = 5;
    } else if (preset === 'full') {
        startMonthIdx = 0;
        endMonthIdx = 11;
    }
    
    document.getElementById('select-start-month').value = startMonthIdx;
    document.getElementById('select-end-month').value = endMonthIdx;
    
    updatePresetButtonActive();
    updateDashboard();
}

// Main logic coordinator
function updateDashboard() {
    if (!appData) return;
    
    if (currentView === 'global') {
        renderGlobalDashboard();
    } else {
        renderUnitDashboard(activeUnitSheet);
    }
}

// Calculate sum for monthly values in selected period
function sumPeriod(values) {
    let sum = 0;
    for (let i = startMonthIdx; i <= endMonthIdx; i++) {
        sum += values[i];
    }
    return sum;
}

// ==========================================
// RENDER VISÃO RESUMO (GLOBAL VIEW)
// ==========================================
function renderGlobalDashboard() {
    let totalOrcado = 0;
    let totalRealizado = 0;
    
    const chartLabels = [];
    const chartOrcadoData = [];
    const chartRealizadoData = [];
    const tableRowsData = [];
    
    // Parse each unit data
    appData.resumo.forEach(resumoUnit => {
        const sheetName = Object.keys(appData.unidades).find(k => appData.unidades[k].unitName === resumoUnit.name);
        if (!sheetName) return;
        
        const unit = appData.unidades[sheetName];
        
        // Sum total rows under Orcado and Realizado for the period
        let orcadoVal = 0;
        let realizadoVal = 0;
        
        const orcadoTotalRow = unit.orcado.find(r => r.label === 'TOTAL GERAL');
        if (orcadoTotalRow) {
            orcadoVal = sumPeriod(orcadoTotalRow.values);
        }
        
        const realizadoTotalRow = unit.realizado.find(r => r.label === 'TOTAL GERAL');
        if (realizadoTotalRow) {
            realizadoVal = sumPeriod(realizadoTotalRow.values);
        }
        
        // Convert to absolute values (despesa é representada positiva para exibição)
        const absOrcado = Math.abs(orcadoVal);
        const absRealizado = Math.abs(realizadoVal);
        const absDiferenca = absOrcado - absRealizado; // Se Orçado > Realizado, temos economia (positivo)
        const ratio = absOrcado > 0 ? (absRealizado / absOrcado) : 0;
        
        totalOrcado += absOrcado;
        totalRealizado += absRealizado;
        
        chartLabels.push(sheetName);
        chartOrcadoData.push(absOrcado);
        chartRealizadoData.push(absRealizado);
        
        tableRowsData.push({
            sheetName: sheetName,
            unitName: resumoUnit.name,
            orcado: absOrcado,
            realizado: absRealizado,
            diferenca: absDiferenca,
            ratio: ratio
        });
    });
    
    const totalDiferenca = totalOrcado - totalRealizado;
    const overallRatio = totalOrcado > 0 ? (totalRealizado / totalOrcado) : 0;
    
    // Update KPI metrics Cards
    document.getElementById('kpi-orcado').textContent = formatCurrency(totalOrcado);
    document.getElementById('kpi-realizado').textContent = formatCurrency(totalRealizado);
    
    const kpiDesvio = document.getElementById('kpi-desvio');
    const kpiDesvioFooter = document.getElementById('kpi-desvio-footer');
    kpiDesvio.textContent = formatCurrency(totalDiferenca);
    
    if (totalDiferenca >= 0) {
        kpiDesvio.style.color = 'var(--color-success)';
        kpiDesvioFooter.textContent = 'Economia (Abaixo do Orçado)';
        document.getElementById('kpi-desvio-icon').className = 'kpi-icon success';
    } else {
        kpiDesvio.style.color = 'var(--color-danger)';
        kpiDesvioFooter.textContent = 'Déficit (Acima do Orçado)';
        document.getElementById('kpi-desvio-icon').className = 'kpi-icon danger';
    }
    
    document.getElementById('kpi-percentual').textContent = formatPercentage(overallRatio);
    
    // Render Table Rows
    const tbody = document.getElementById('table-global-rows');
    tbody.innerHTML = '';
    
    tableRowsData.forEach(row => {
        const tr = document.createElement('tr');
        tr.className = 'link-row';
        tr.onclick = () => switchView(row.sheetName);
        
        const badgeClass = row.diferenca >= 0 ? 'success' : 'danger';
        const diffPrefix = row.diferenca >= 0 ? '+' : '-';
        
        tr.innerHTML = `
            <td class="cell-bold">${row.sheetName} <span style="font-weight:400; color:var(--text-secondary); font-size:0.8rem;">(${row.unitName})</span></td>
            <td class="cell-right">${formatCurrency(row.orcado)}</td>
            <td class="cell-right">${formatCurrency(row.realizado)}</td>
            <td class="cell-right">
                <span class="badge ${badgeClass}">${formatCurrency(row.diferenca)}</span>
            </td>
            <td class="cell-right cell-bold" style="color: ${row.ratio > 1 ? 'var(--color-danger)' : 'var(--text-primary)'}">
                ${formatPercentage(row.ratio)}
            </td>
        `;
        tbody.appendChild(tr);
    });
    
    // Render Table Totals Footer
    const tfoot = document.getElementById('table-global-totals');
    const overallDiffBadgeClass = totalDiferenca >= 0 ? 'success' : 'danger';
    tfoot.innerHTML = `
        <td>Total Geral</td>
        <td class="cell-right">${formatCurrency(totalOrcado)}</td>
        <td class="cell-right">${formatCurrency(totalRealizado)}</td>
        <td class="cell-right">
            <span class="badge ${overallDiffBadgeClass}">${formatCurrency(totalDiferenca)}</span>
        </td>
        <td class="cell-right">${formatPercentage(overallRatio)}</td>
    `;
    
    // Render Chart 1: Global Compare
    if (globalCompareChart) globalCompareChart.destroy();
    
    const ctxCompare = document.getElementById('chart-global-compare').getContext('2d');
    globalCompareChart = new Chart(ctxCompare, {
        type: 'bar',
        data: {
            labels: chartLabels,
            datasets: [
                {
                    label: 'Orçado (R$)',
                    data: chartOrcadoData,
                    backgroundColor: 'rgba(59, 130, 246, 0.4)',
                    borderColor: 'rgba(59, 130, 246, 1)',
                    borderWidth: 1.5,
                    borderRadius: 4
                },
                {
                    label: 'Realizado (R$)',
                    data: chartRealizadoData,
                    backgroundColor: 'rgba(16, 185, 129, 0.5)',
                    borderColor: 'rgba(16, 185, 129, 1)',
                    borderWidth: 1.5,
                    borderRadius: 4
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    labels: { color: '#f3f4f6', font: { family: 'Outfit', size: 12 } }
                },
                tooltip: {
                    callbacks: {
                        label: function(context) {
                            return context.dataset.label + ': ' + formatCurrency(context.parsed.y);
                        }
                    }
                }
            },
            scales: {
                x: {
                    grid: { color: 'rgba(255,255,255,0.05)' },
                    ticks: { color: '#9ca3af', font: { family: 'Outfit', size: 10 } }
                },
                y: {
                    grid: { color: 'rgba(255,255,255,0.05)' },
                    ticks: {
                        color: '#9ca3af',
                        font: { family: 'Outfit' },
                        callback: function(value) { return 'R$ ' + value.toLocaleString('pt-BR', { notation: 'compact' }); }
                    }
                }
            }
        }
    });
    
    // Render Chart 2: Global Distribution (top 8 + Outros)
    if (globalDistChart) globalDistChart.destroy();
    
    const items = tableRowsData.map(r => ({ label: r.sheetName, val: r.realizado }));
    items.sort((a, b) => b.val - a.val); // Sort descending
    
    const topN = 8;
    const finalLabels = [];
    const finalValues = [];
    let otherSum = 0;
    
    for (let i = 0; i < items.length; i++) {
        if (i < topN) {
            finalLabels.push(items[i].label);
            finalValues.push(items[i].val);
        } else {
            otherSum += items[i].val;
        }
    }
    
    if (otherSum > 0) {
        finalLabels.push('Outros');
        finalValues.push(otherSum);
    }
    
    const ctxDist = document.getElementById('chart-global-distribution').getContext('2d');
    globalDistChart = new Chart(ctxDist, {
        type: 'doughnut',
        data: {
            labels: finalLabels,
            datasets: [{
                data: finalValues,
                backgroundColor: [
                    '#3b82f6', '#10b981', '#f59e0b', '#8b5cf6', 
                    '#ec4899', '#06b6d4', '#14b8a6', '#f43f5e', '#6b7280'
                ],
                borderWidth: 1,
                borderColor: '#0d1224'
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    position: 'right',
                    labels: { color: '#f3f4f6', font: { family: 'Outfit', size: 11 } }
                },
                tooltip: {
                    callbacks: {
                        label: function(context) {
                            const val = context.parsed;
                            const total = context.dataset.data.reduce((a, b) => a + b, 0);
                            const percent = (val / total) * 100;
                            return context.label + ': ' + formatCurrency(val) + ' (' + percent.toFixed(1) + '%)';
                        }
                    }
                }
            }
        }
    });
}

// ==========================================
// RENDER VISÃO DETALHADA POR UNIDADE (UNIT VIEW)
// ==========================================
function renderUnitDashboard(sheetName) {
    const unit = appData.unidades[sheetName];
    
    // Notice Box logic
    const noticeBox = document.getElementById('unit-notice-box');
    if (unitNotices[sheetName]) {
        noticeBox.style.display = 'block';
        noticeBox.innerHTML = `
            <svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round">
                <circle cx="12" cy="12" r="10"></circle>
                <line x1="12" y1="8" x2="12" y2="12"></line>
                <line x1="12" y1="16" x2="12.01" y2="16"></line>
            </svg>
            ${unitNotices[sheetName]}
        `;
    } else {
        noticeBox.style.display = 'none';
    }
    
    // 1. Calculate Monthly stats for the period
    const labels = [];
    const orcadoValues = [];
    const realizadoValues = [];
    
    // Find the totals row
    const orcadoTotalRow = unit.orcado.find(r => r.label === 'TOTAL GERAL');
    const realizadoTotalRow = unit.realizado.find(r => r.label === 'TOTAL GERAL');
    
    for (let m = startMonthIdx; m <= endMonthIdx; m++) {
        labels.push(shortMonthNames[m]);
        orcadoValues.push(orcadoTotalRow ? Math.abs(orcadoTotalRow.values[m]) : 0);
        realizadoValues.push(realizadoTotalRow ? Math.abs(realizadoTotalRow.values[m]) : 0);
    }
    
    const sumOrcado = orcadoValues.reduce((a, b) => a + b, 0);
    const sumRealizado = realizadoValues.reduce((a, b) => a + b, 0);
    const sumDiferenca = sumOrcado - sumRealizado;
    const ratio = sumOrcado > 0 ? (sumRealizado / sumOrcado) : 0;
    
    // Update unit KPIs cards
    document.getElementById('kpi-orcado').textContent = formatCurrency(sumOrcado);
    document.getElementById('kpi-realizado').textContent = formatCurrency(sumRealizado);
    
    const kpiDesvio = document.getElementById('kpi-desvio');
    const kpiDesvioFooter = document.getElementById('kpi-desvio-footer');
    kpiDesvio.textContent = formatCurrency(sumDiferenca);
    
    if (sumDiferenca >= 0) {
        kpiDesvio.style.color = 'var(--color-success)';
        kpiDesvioFooter.textContent = 'Economia no período';
        document.getElementById('kpi-desvio-icon').className = 'kpi-icon success';
    } else {
        kpiDesvio.style.color = 'var(--color-danger)';
        kpiDesvioFooter.textContent = 'Acima do Orçado';
        document.getElementById('kpi-desvio-icon').className = 'kpi-icon danger';
    }
    document.getElementById('kpi-percentual').textContent = formatPercentage(ratio);
    
    // 2. Render evolution chart
    if (unitMonthlyChart) unitMonthlyChart.destroy();
    
    const ctxMonthly = document.getElementById('chart-unit-monthly').getContext('2d');
    unitMonthlyChart = new Chart(ctxMonthly, {
        type: 'bar',
        data: {
            labels: labels,
            datasets: [
                {
                    label: 'Orçado (R$)',
                    data: orcadoValues,
                    backgroundColor: 'rgba(59, 130, 246, 0.4)',
                    borderColor: 'rgba(59, 130, 246, 1)',
                    borderWidth: 1.5,
                    borderRadius: 4
                },
                {
                    label: 'Realizado (R$)',
                    data: realizadoValues,
                    backgroundColor: 'rgba(16, 185, 129, 0.5)',
                    borderColor: 'rgba(16, 185, 129, 1)',
                    borderWidth: 1.5,
                    borderRadius: 4
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { labels: { color: '#f3f4f6', font: { family: 'Outfit' } } },
                tooltip: {
                    callbacks: {
                        label: function(context) { return context.dataset.label + ': ' + formatCurrency(context.parsed.y); }
                    }
                }
            },
            scales: {
                x: { grid: { color: 'rgba(255,255,255,0.05)' }, ticks: { color: '#9ca3af', font: { family: 'Outfit' } } },
                y: {
                    grid: { color: 'rgba(255,255,255,0.05)' },
                    ticks: {
                        color: '#9ca3af',
                        font: { family: 'Outfit' },
                        callback: function(value) { return 'R$ ' + value.toLocaleString('pt-BR'); }
                    }
                }
            }
        }
    });
    
    // 3. Render consumption chart (if available)
    const consumptionOrcadoRow = unit.orcado.find(r => r.type === 'consumo');
    const consumptionRealizadoRow = unit.realizado.find(r => r.type === 'consumo');
    const canvasConsumption = document.getElementById('chart-unit-consumption');
    const chartConsParent = canvasConsumption.parentElement.parentElement;
    
    if (consumptionOrcadoRow || consumptionRealizadoRow) {
        chartConsParent.style.display = 'block';
        
        const consOrcadoData = [];
        const consRealData = [];
        for (let m = startMonthIdx; m <= endMonthIdx; m++) {
            consOrcadoData.push(consumptionOrcadoRow ? consumptionOrcadoRow.values[m] : 0);
            consRealData.push(consumptionRealizadoRow ? consumptionRealizadoRow.values[m] : 0);
        }
        
        if (unitConsumptionChart) unitConsumptionChart.destroy();
        
        const ctxCons = canvasConsumption.getContext('2d');
        unitConsumptionChart = new Chart(ctxCons, {
            type: 'line',
            data: {
                labels: labels,
                datasets: [
                    {
                        label: 'Previsão Consumo (kWh)',
                        data: consOrcadoData,
                        borderColor: 'rgba(245, 158, 11, 1)',
                        backgroundColor: 'rgba(245, 158, 11, 0.1)',
                        borderWidth: 2,
                        tension: 0.15,
                        fill: false
                    },
                    {
                        label: 'Consumo Real (kWh)',
                        data: consRealData,
                        borderColor: 'rgba(6, 182, 212, 1)',
                        backgroundColor: 'rgba(6, 182, 212, 0.1)',
                        borderWidth: 2,
                        tension: 0.15,
                        fill: false
                    }
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: { labels: { color: '#f3f4f6', font: { family: 'Outfit' } } },
                    tooltip: {
                        callbacks: {
                            label: function(context) { return context.dataset.label + ': ' + formatNumber(context.parsed.y) + ' kWh'; }
                        }
                    }
                },
                scales: {
                    x: { grid: { color: 'rgba(255,255,255,0.05)' }, ticks: { color: '#9ca3af', font: { family: 'Outfit' } } },
                    y: {
                        grid: { color: 'rgba(255,255,255,0.05)' },
                        ticks: {
                            color: '#9ca3af',
                            font: { family: 'Outfit' },
                            callback: function(value) { return formatNumber(value) + ' kWh'; }
                        }
                    }
                }
            }
        });
    } else {
        chartConsParent.style.display = 'none'; // Hide if no consumption rows
    }
    
    // 4. Render Table: Monthly details
    // We want a list of columns for each distinct contract/cost row in Orcado and Realizado
    const orcadoItems = unit.orcado.filter(r => r.type === 'custo' && r.label !== 'TOTAL GERAL');
    const realizadoItems = unit.realizado.filter(r => r.type === 'custo' && r.label !== 'TOTAL GERAL');
    
    const tableHeader = document.getElementById('table-unit-header');
    tableHeader.innerHTML = `
        <th>Mês</th>
        <th class="cell-right">Total Orçado (R$)</th>
        <th class="cell-right">Total Realizado (R$)</th>
        <th class="cell-right">Diferença (R$)</th>
        <th class="cell-right">Percentual</th>
    `;
    
    const tableBody = document.getElementById('table-unit-rows');
    tableBody.innerHTML = '';
    
    for (let m = startMonthIdx; m <= endMonthIdx; m++) {
        const oTotal = orcadoTotalRow ? Math.abs(orcadoTotalRow.values[m]) : 0;
        const rTotal = realizadoTotalRow ? Math.abs(realizadoTotalRow.values[m]) : 0;
        const diff = oTotal - rTotal;
        const pct = oTotal > 0 ? (rTotal / oTotal) : 0;
        
        const tr = document.createElement('tr');
        const badgeClass = diff >= 0 ? 'success' : 'danger';
        
        tr.innerHTML = `
            <td class="cell-bold">${monthNames[m]}</td>
            <td class="cell-right">${formatCurrency(oTotal)}</td>
            <td class="cell-right">${formatCurrency(rTotal)}</td>
            <td class="cell-right">
                <span class="badge ${badgeClass}">${formatCurrency(diff)}</span>
            </td>
            <td class="cell-right cell-bold" style="color: ${pct > 1 ? 'var(--color-danger)' : 'var(--text-primary)'}">
                ${formatPercentage(pct)}
            </td>
        `;
        tableBody.appendChild(tr);
    }
    
    // Add detail totals row
    const footTr = document.createElement('tr');
    footTr.className = 'row-total';
    const totalDiff = sumOrcado - sumRealizado;
    const totalBadgeClass = totalDiff >= 0 ? 'success' : 'danger';
    footTr.innerHTML = `
        <td>Total Período</td>
        <td class="cell-right">${formatCurrency(sumOrcado)}</td>
        <td class="cell-right">${formatCurrency(sumRealizado)}</td>
        <td class="cell-right">
            <span class="badge ${totalBadgeClass}">${formatCurrency(totalDiff)}</span>
        </td>
        <td class="cell-right">${formatPercentage(ratio)}</td>
    `;
    tableBody.appendChild(footTr);

    // 5. Populate and handle Month Selector in Cost Items card
    const costMonthSelect = document.getElementById('select-cost-item-month');
    
    // Save current selection if valid, otherwise default to startMonthIdx
    let selectedMonthVal = parseInt(costMonthSelect.value);
    if (isNaN(selectedMonthVal) || selectedMonthVal < startMonthIdx || selectedMonthVal > endMonthIdx) {
        selectedMonthVal = startMonthIdx;
    }
    
    // Build select options based on current period range
    costMonthSelect.innerHTML = '';
    for (let m = startMonthIdx; m <= endMonthIdx; m++) {
        const opt = document.createElement('option');
        opt.value = m;
        opt.textContent = monthNames[m];
        if (m === selectedMonthVal) opt.selected = true;
        costMonthSelect.appendChild(opt);
    }
    
    // Render the cost items table for the selected month
    renderUnitCostItemsTable(unit, selectedMonthVal);
}

// Callback when user changes the month inside the Cost Items Breakdown panel
function onCostItemMonthChange() {
    if (!appData || !activeUnitSheet) return;
    const unit = appData.unidades[activeUnitSheet];
    const selectedMonthVal = parseInt(document.getElementById('select-cost-item-month').value);
    renderUnitCostItemsTable(unit, selectedMonthVal);
}

// Helper to render the itemized costs table for a single specific month
function renderUnitCostItemsTable(unit, m) {
    const costItemsBody = document.getElementById('table-unit-cost-items-rows');
    costItemsBody.innerHTML = '';
    
    // Find all distinct cost item labels in both orcado and realizado sections
    const costLabels = new Set();
    unit.orcado.forEach(item => {
        if (item.type === 'custo' && item.label !== 'TOTAL GERAL') {
            costLabels.add(item.label);
        }
    });
    unit.realizado.forEach(item => {
        if (item.type === 'custo' && item.label !== 'TOTAL GERAL') {
            costLabels.add(item.label);
        }
    });
    const costLabelsArray = Array.from(costLabels);
    
    let totalItemsOrcado = 0;
    let totalItemsRealizado = 0;
    
    costLabelsArray.forEach(label => {
        // Find corresponding rows
        const oRow = unit.orcado.find(r => r.label === label);
        const rRow = unit.realizado.find(r => r.label === label);
        
        const oVal = oRow ? Math.abs(oRow.values[m]) : 0;
        const rVal = rRow ? Math.abs(rRow.values[m]) : 0;
        
        // Skip rows where both orcado and realizado are 0 to keep the table clean
        if (oVal < 0.01 && rVal < 0.01) return;
        
        const itemDiff = oVal - rVal;
        const itemPct = oVal > 0 ? (rVal / oVal) : 0;
        
        totalItemsOrcado += oVal;
        totalItemsRealizado += rVal;
        
        const tr = document.createElement('tr');
        const badgeClass = itemDiff >= 0 ? 'success' : 'danger';
        
        tr.innerHTML = `
            <td class="cell-bold">${label}</td>
            <td class="cell-right">${formatCurrency(oVal)}</td>
            <td class="cell-right">${formatCurrency(rVal)}</td>
            <td class="cell-right">
                <span class="badge ${badgeClass}">${formatCurrency(itemDiff)}</span>
            </td>
            <td class="cell-right cell-bold" style="color: ${itemPct > 1 ? 'var(--color-danger)' : 'var(--text-primary)'}">
                ${formatPercentage(itemPct)}
            </td>
        `;
        costItemsBody.appendChild(tr);
    });
    
    // Add cost items total row
    const costTotalTr = document.createElement('tr');
    costTotalTr.className = 'row-total';
    const totalItemsDiff = totalItemsOrcado - totalItemsRealizado;
    const totalItemsBadgeClass = totalItemsDiff >= 0 ? 'success' : 'danger';
    const overallItemsPct = totalItemsOrcado > 0 ? (totalItemsRealizado / totalItemsOrcado) : 0;
    
    costTotalTr.innerHTML = `
        <td class="cell-bold">Total Geral (${monthNames[m]})</td>
        <td class="cell-right">${formatCurrency(totalItemsOrcado)}</td>
        <td class="cell-right">${formatCurrency(totalItemsRealizado)}</td>
        <td class="cell-right">
            <span class="badge ${totalItemsBadgeClass}">${formatCurrency(totalItemsDiff)}</span>
        </td>
        <td class="cell-right">${formatPercentage(overallItemsPct)}</td>
    `;
    costItemsBody.appendChild(costTotalTr);
}
