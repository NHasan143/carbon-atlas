export function initAtlas(){
  let Plotly;

  var DATA = null;
  var YEARS = [];
  var COUNTRIES_BY_ISO = {};
  var COUNTRIES_SORTED = [];
  var currentYearIdx = 0;
  var highlighted = ["USA","CHN","IND"]; // slot order = series 1/2/3
  var choroMetric = "co2_per_capita";
  var scatterXMetric = "gdp_per_capita";
  var scatterYMetric = "co2_per_capita";
  var maxPopulation = 1;
  var playTimer = null;

  function getVar(name){
    return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  }

  function theme(){
    return {
      surface: getVar("--surface"),
      surface2: getVar("--surface-2"),
      text: getVar("--text-primary"),
      textSecondary: getVar("--text-secondary"),
      textMuted: getVar("--text-muted"),
      grid: getVar("--grid"),
      axis: getVar("--axis"),
      border: getVar("--border"),
      context: getVar("--context-dot"),
      seq: [getVar("--seq-100"),getVar("--seq-200"),getVar("--seq-300"),getVar("--seq-400"),getVar("--seq-500"),getVar("--seq-600"),getVar("--seq-700")],
      series: [getVar("--accent"), getVar("--accent-2"), getVar("--accent-3")],
      fontFamily: "IBM Plex Sans, system-ui, sans-serif"
    };
  }

  function fmtValue(v, metric){
    if (v === null || v === undefined || isNaN(v)) return "—";
    if (metric === "co2_per_capita") return v.toFixed(2) + " t";
    if (metric === "co2") return v.toLocaleString(undefined,{maximumFractionDigits:0}) + " Mt";
    if (metric === "share_global_co2") return v.toFixed(2) + "%";
    if (metric === "gdp_per_capita") return "$" + v.toLocaleString(undefined,{maximumFractionDigits:0});
    if (metric === "renewables_share_energy") return v.toFixed(1) + "%";
    if (metric === "population") return v.toLocaleString(undefined,{maximumFractionDigits:0});
    return String(v);
  }

  function metricLabel(metric){
    var m = DATA.metricMeta[metric];
    return m ? (m.label + " (" + m.unit + ")") : metric;
  }

  function seriesAt(iso, metric){
    var m = DATA.metrics[metric];
    return m ? (m[iso] || null) : null;
  }

  function valueAt(iso, metric, yearIdx){
    var s = seriesAt(iso, metric);
    return s ? s[yearIdx] : null;
  }

  function axisType(metric){
    return (metric === "gdp_per_capita" || metric === "population") ? "log" : "linear";
  }

  // ---------- bootstrap ----------
  function setControlsEnabled(enabled){
    document.querySelectorAll("#controlsPanel button, #controlsPanel input, #controlsPanel select, #choroMetric, #scatterX, #scatterY").forEach(function(control){
      control.disabled = !enabled;
    });
  }

  setControlsEnabled(false);
  const assetBase = import.meta.env.BASE_URL.replace(/\/$/, '') + '/';
  Promise.all([
    import("plotly.js-dist-min").then(function(module){
      Plotly = module.default;
    }).catch(function(){
      throw new Error("The chart library could not load. Reload the atlas to try again.");
    }),
    fetch(assetBase + "dataset.json").then(function(response){
      if (!response.ok) throw new Error("HTTP " + response.status);
      return response.json();
    }).catch(function(){
      throw new Error("The atlas data could not load. Check your connection and reload the atlas.");
    })
  ]).then(function([, d]){
    DATA = d;
    YEARS = d.years;
    d.countries.forEach(function(c){ COUNTRIES_BY_ISO[c.iso3] = c; });
    COUNTRIES_SORTED = d.countries.slice().sort(function(a,b){ return a.name.localeCompare(b.name); });

    Object.keys(d.metrics).forEach(function(metric){
      Object.keys(d.metrics[metric]).forEach(function(iso){
        d.metrics[metric][iso].forEach(function(v){
          if (metric === "population" && v && v > maxPopulation) maxPopulation = v;
        });
      });
    });

    currentYearIdx = YEARS.length - 1;
    document.getElementById("yearSlider").max = YEARS.length - 1;
    document.getElementById("yearSlider").value = currentYearIdx;
    document.getElementById("yearReadout").textContent = YEARS[currentYearIdx];

    buildMetricDropdown(document.getElementById("choroMetric"), choroMetric);
    buildMetricDropdown(document.getElementById("scatterX"), scatterXMetric);
    buildMetricDropdown(document.getElementById("scatterY"), scatterYMetric);
    buildCompareDropdowns();

    updateCompareTable();
    return Promise.all([renderChoropleth(), renderScatter(), renderSmallMultiples()]);
  }).then(function(){
    wireEvents();
    setControlsEnabled(true);
    document.getElementById("loadStatus").hidden = true;
  }).catch(function(error){
    console.error("Atlas initialization failed:", error);
    setControlsEnabled(false);
    var status = document.getElementById("loadStatus");
    status.textContent = error.message;
    status.hidden = false;
    document.getElementById("loadRetry").hidden = false;
  });

  function buildMetricDropdown(sel, selected){
    sel.innerHTML = "";
    Object.keys(DATA.metricMeta).forEach(function(key){
      var opt = document.createElement("option");
      opt.value = key;
      opt.textContent = DATA.metricMeta[key].label;
      if (key === selected) opt.selected = true;
      sel.appendChild(opt);
    });
  }

  function buildCompareDropdowns(){
    var byContinent = {};
    COUNTRIES_SORTED.forEach(function(c){
      (byContinent[c.continent] = byContinent[c.continent] || []).push(c);
    });
    var continents = Object.keys(byContinent).sort();

    [0,1,2].forEach(function(slot){
      var sel = document.getElementById("cmp" + slot);
      sel.innerHTML = "";
      var noneOpt = document.createElement("option");
      noneOpt.value = ""; noneOpt.textContent = "— none —";
      sel.appendChild(noneOpt);
      continents.forEach(function(cont){
        var group = document.createElement("optgroup");
        group.label = cont;
        byContinent[cont].forEach(function(c){
          var opt = document.createElement("option");
          opt.value = c.iso3; opt.textContent = c.name;
          group.appendChild(opt);
        });
        sel.appendChild(group);
      });
      sel.value = highlighted[slot] || "";
    });
  }

  function wireEvents(){
    document.getElementById("yearSlider").addEventListener("input", function(e){
      currentYearIdx = parseInt(e.target.value, 10);
      onYearChange();
    });
    document.getElementById("playBtn").addEventListener("click", togglePlay);
    document.getElementById("choroMetric").addEventListener("change", function(e){
      choroMetric = e.target.value;
      renderChoropleth();
    });
    document.getElementById("scatterX").addEventListener("change", function(e){
      scatterXMetric = e.target.value;
      renderScatter();
    });
    document.getElementById("scatterY").addEventListener("change", function(e){
      scatterYMetric = e.target.value;
      renderScatter();
    });
    [0,1,2].forEach(function(slot){
      document.getElementById("cmp" + slot).addEventListener("change", function(e){
        var iso = e.target.value;
        // avoid duplicate picks across slots
        [0,1,2].forEach(function(other){
          if (other !== slot && highlighted[other] === iso && iso !== "") {
            highlighted[other] = "";
            document.getElementById("cmp" + other).value = "";
          }
        });
        highlighted[slot] = iso;
        renderScatter();
        renderSmallMultiples();
        updateCompareTable();
      });
    });

    var mq = window.matchMedia("(prefers-color-scheme: dark)");
    if (mq.addEventListener) mq.addEventListener("change", reTheme);
    new MutationObserver(reTheme).observe(document.documentElement, {attributes:true, attributeFilter:["data-theme"]});
  }

  function reTheme(){
    renderChoropleth();
    renderScatter();
    renderSmallMultiples();
  }

  function setPlayState(playing){
    document.getElementById("playLabel").textContent = playing ? "Pause" : "Play";
    document.getElementById("playIcon").style.display = playing ? "none" : "block";
    document.getElementById("pauseIcon").style.display = playing ? "block" : "none";
    document.getElementById("playBtn").setAttribute("aria-pressed", String(playing));
  }

  function togglePlay(){
    var btn = document.getElementById("playBtn");
    if (playTimer){
      clearInterval(playTimer);
      playTimer = null;
      setPlayState(false);
      btn.setAttribute("aria-label", "Play animation");
      return;
    }
    setPlayState(true);
    btn.setAttribute("aria-label", "Pause animation");
    playTimer = setInterval(function(){
      currentYearIdx += 1;
      if (currentYearIdx > YEARS.length - 1) currentYearIdx = 0;
      document.getElementById("yearSlider").value = currentYearIdx;
      onYearChange();
    }, 650);
  }

  function onYearChange(){
    document.getElementById("yearReadout").textContent = YEARS[currentYearIdx];
    updateChoroplethYear();
    updateScatterYear();
    updateSmallMultipleMarkers();
    updateCompareTable();
  }

  // ---------- Choropleth ----------
  function choroplethZ(metric){
    return COUNTRIES_SORTED.map(function(c){
      var v = valueAt(c.iso3, metric, currentYearIdx);
      return v === null || v === undefined ? null : v;
    });
  }

  function metricRange(metric){
    // Capped at the 98th percentile (precomputed) rather than the true max,
    // so a handful of extreme outliers don't wash out every other country's
    // color. Plotly clips anything above zmax to the darkest swatch.
    return [0, DATA.metricMeta[metric].vmax];
  }

  function renderChoropleth(){
    var t = theme();
    var locations = COUNTRIES_SORTED.map(function(c){ return c.iso3; });
    var z = choroplethZ(choroMetric);
    var range = metricRange(choroMetric);
    var meta = DATA.metricMeta[choroMetric];

    document.getElementById("choroSub").textContent =
      "Colored by " + meta.label.toLowerCase() + " (" + meta.unit + ") for the selected year.";
    var noDataNote = choroMetric === "renewables_share_energy"
      ? "Gray countries have no reliable energy-mix data for this metric."
      : "Gray countries have no data for this metric in this year.";
    document.getElementById("choroCaption").textContent =
      noDataNote + " The color scale caps at the 98th percentile so a few extreme outliers don't wash out everyone else — the highest values are shown pinned to the darkest shade.";

    var trace = {
      type: "choropleth",
      locationmode: "ISO-3",
      locations: locations,
      z: z,
      zmin: range[0],
      zmax: range[1],
      colorscale: [[0,t.seq[0]],[1/6,t.seq[1]],[2/6,t.seq[2]],[3/6,t.seq[3]],[4/6,t.seq[4]],[5/6,t.seq[5]],[1,t.seq[6]]],
      marker: { line: { color: t.border, width: 0.4 } },
      colorbar: {
        title: { text: meta.unit, font: { color: t.textSecondary, size: 11, family: t.fontFamily } },
        tickfont: { color: t.textSecondary, size: 11, family: t.fontFamily },
        outlinewidth: 0, thickness: 12, len: 0.7
      },
      hovertemplate: "%{text}<br>" + meta.label + ": %{z}<extra></extra>",
      text: locations.map(function(iso){ return COUNTRIES_BY_ISO[iso].name; })
    };

    // showcountries draws every country's outline (from the same self-hosted
    // world_110m.json below), so a country with no value for this metric still
    // reads as "on the map, just uncolored" rather than vanishing into the ocean.
    var layout = {
      paper_bgcolor: t.surface,
      plot_bgcolor: t.surface,
      font: { color: t.text, family: t.fontFamily },
      margin: { l:0, r:0, t:0, b:0 },
      geo: {
        scope: "world",
        resolution: 110,
        showframe: false,
        showcoastlines: false,
        showland: false,
        showocean: false,
        showcountries: true,
        countrycolor: t.grid,
        showlakes: false,
        projection: { type: "natural earth" },
        bgcolor: t.surface
      }
    };

    // Plotly's default base-map atlas streams from Plotly's own CDN at draw
    // time; topojsonURL redirects that one request to a same-origin file
    // (world_110m.json, published next to this page) built from Natural Earth
    // 110m data, so nothing is fetched from an external host at runtime.
    return Plotly.react("choroplethChart", [trace], layout, {displayModeBar:false, responsive:true, topojsonURL:assetBase});
  }

  function updateChoroplethYear(){
    Plotly.restyle("choroplethChart", { z: [choroplethZ(choroMetric)] });
  }

  // ---------- Scatter ----------
  function scatterFrameData(){
    var contextIso=[], contextX=[], contextY=[], contextSize=[], contextText=[];
    var seriesData = [[],[],[]]; // per highlighted slot: {iso,x,y,size,text}

    COUNTRIES_SORTED.forEach(function(c){
      var x = valueAt(c.iso3, scatterXMetric, currentYearIdx);
      var y = valueAt(c.iso3, scatterYMetric, currentYearIdx);
      var pop = valueAt(c.iso3, "population", currentYearIdx);
      if (x === null || y === null || x === undefined || y === undefined) return;
      if (x <= 0 && axisType(scatterXMetric) === "log") return;
      if (y <= 0 && axisType(scatterYMetric) === "log") return;
      var slot = highlighted.indexOf(c.iso3);
      var size = pop || (maxPopulation * 0.002);
      if (slot === -1){
        contextIso.push(c.iso3); contextX.push(x); contextY.push(y); contextSize.push(size); contextText.push(c.name);
      } else {
        seriesData[slot].push({x:x,y:y,size:size,text:c.name});
      }
    });
    return { contextX:contextX, contextY:contextY, contextSize:contextSize, contextText:contextText, seriesData:seriesData };
  }

  function bubbleSizeref(){
    return 2.0 * maxPopulation / Math.pow(46, 2);
  }

  function renderScatter(){
    var t = theme();
    var f = scatterFrameData();
    var xMeta = DATA.metricMeta[scatterXMetric], yMeta = DATA.metricMeta[scatterYMetric];

    var traces = [{
      type: "scattergl", mode: "markers", name: "Other countries",
      x: f.contextX, y: f.contextY, text: f.contextText,
      marker: { size: f.contextSize, sizemode:"area", sizeref: bubbleSizeref(), sizemin:3,
                color: t.context, opacity:0.55, line:{width:0} },
      hovertemplate: "%{text}<br>" + xMeta.label + ": %{x}<br>" + yMeta.label + ": %{y}<extra></extra>",
      showlegend:false
    }];

    [0,1,2].forEach(function(slot){
      var iso = highlighted[slot];
      if (!iso) return;
      var rows = f.seriesData[slot];
      if (!rows.length) return;
      traces.push({
        type:"scattergl", mode:"markers+text", name: COUNTRIES_BY_ISO[iso].name,
        x: rows.map(function(r){return r.x;}), y: rows.map(function(r){return r.y;}),
        text: rows.map(function(r){return r.text;}), textposition:"top center",
        textfont: { color: t.text, size: 11, family: t.fontFamily },
        marker: { size: rows.map(function(r){return r.size;}), sizemode:"area", sizeref: bubbleSizeref(), sizemin:6,
                  color: SERIES_COLORS_LIVE()[slot], line:{ color:t.surface, width:1.5 } },
        hovertemplate: "<b>%{text}</b><br>" + xMeta.label + ": %{x}<br>" + yMeta.label + ": %{y}<extra></extra>",
        showlegend:false
      });
    });

    var layout = {
      paper_bgcolor: t.surface, plot_bgcolor: t.surface,
      font: { color: t.textSecondary, family: t.fontFamily, size:12 },
      margin: { l:64, r:20, t:10, b:52 },
      xaxis: { title:{text:metricLabel(scatterXMetric)}, type:axisType(scatterXMetric),
                gridcolor:t.grid, zerolinecolor:t.axis, linecolor:t.axis, tickfont:{color:t.textSecondary} },
      yaxis: { title:{text:metricLabel(scatterYMetric)}, type:axisType(scatterYMetric),
                gridcolor:t.grid, zerolinecolor:t.axis, linecolor:t.axis, tickfont:{color:t.textSecondary} }
    };

    return Plotly.react("scatterChart", traces, layout, {displayModeBar:false, responsive:true});
  }

  function SERIES_COLORS_LIVE(){
    return [getVar("--accent"), getVar("--accent-2"), getVar("--accent-3")];
  }

  function updateScatterYear(){
    renderScatter();
  }

  // ---------- Small multiples ----------
  var SM_METRICS = ["co2_per_capita","co2","renewables_share_energy","gdp_per_capita","share_global_co2"];

  function renderSmallMultiples(){
    var grid = document.getElementById("smGrid");
    var anyHighlighted = highlighted.some(function(i){ return !!i; });
    if (!anyHighlighted){
      grid.innerHTML = '<p class="empty-note">Pick at least one country above to see its trends.</p>';
      return;
    }
    if (grid.children.length !== SM_METRICS.length || grid.dataset.built !== "1"){
      grid.innerHTML = "";
      SM_METRICS.forEach(function(metric){
        var cell = document.createElement("div");
        cell.className = "sm-cell";
        cell.innerHTML = '<p class="sm-title">'+DATA.metricMeta[metric].label+' ('+DATA.metricMeta[metric].unit+')</p>' +
                          '<div class="chart-sm" id="sm-'+metric+'"></div>';
        grid.appendChild(cell);
      });
      grid.dataset.built = "1";
    }
    return Promise.all(SM_METRICS.map(renderSmallMultiple));
  }

  function renderSmallMultiple(metric){
    var t = theme();
    var traces = [];
    [0,1,2].forEach(function(slot){
      var iso = highlighted[slot];
      if (!iso) return;
      var series = seriesAt(iso, metric);
      if (!series) return;
      var xs=[], ys=[];
      series.forEach(function(v,i){ if (v!==null && v!==undefined){ xs.push(YEARS[i]); ys.push(v); } });
      if (!xs.length) return;
      traces.push({
        type:"scatter", mode:"lines", name: COUNTRIES_BY_ISO[iso].name,
        x: xs, y: ys,
        line: { color: SERIES_COLORS_LIVE()[slot], width:2, shape:"spline", smoothing:0.3 },
        hovertemplate: "<b>"+COUNTRIES_BY_ISO[iso].name+"</b><br>%{x}: %{y}<extra></extra>",
        showlegend:false
      });
    });

    var annotations = traces.map(function(tr){
      var lastX = tr.x[tr.x.length-1], lastY = tr.y[tr.y.length-1];
      return { x:lastX, y:lastY, text:tr.name, xanchor:"left", showarrow:false,
                font:{color:tr.line.color, size:10, family:theme().fontFamily}, xshift:6 };
    });

    var currentYear = YEARS[currentYearIdx];
    var shapes = [{ type:"line", x0:currentYear, x1:currentYear, y0:0, y1:1, yref:"paper",
                    line:{ color:t.textMuted, width:1, dash:"dot" } }];

    var layout = {
      paper_bgcolor: t.surface, plot_bgcolor: t.surface,
      font: { color: t.textSecondary, family: t.fontFamily, size:10 },
      margin: { l:34, r:44, t:6, b:22 },
      xaxis: { gridcolor:"transparent", linecolor:t.axis, tickfont:{size:10}, tickvals:[1990,2005,2023] },
      yaxis: { gridcolor:t.grid, zerolinecolor:t.axis, linecolor:"transparent", tickfont:{size:10} },
      shapes: shapes,
      annotations: annotations,
      showlegend:false
    };

    var elId = "sm-" + metric;
    if (document.getElementById(elId)){
      return Plotly.react(elId, traces, layout, {displayModeBar:false, responsive:true});
    }
  }

  function updateSmallMultipleMarkers(){
    var currentYear = YEARS[currentYearIdx];
    SM_METRICS.forEach(function(metric){
      var elId = "sm-" + metric;
      var el = document.getElementById(elId);
      if (!el || !el.data) return;
      Plotly.relayout(elId, { "shapes[0].x0": currentYear, "shapes[0].x1": currentYear });
    });
  }

  // ---------- Comparison table ----------
  var TABLE_METRICS = ["co2_per_capita","co2","share_global_co2","gdp_per_capita","renewables_share_energy","population"];

  function updateCompareTable(){
    var table = document.getElementById("compareTable");
    var rows = highlighted.map(function(iso, slot){ return iso ? {iso:iso, slot:slot} : null; }).filter(Boolean);
    if (!rows.length){
      table.innerHTML = '';
      document.getElementById("compareEmpty").hidden = false;
      table.hidden = true;
      return;
    }
    document.getElementById("compareEmpty").hidden = true;
    table.hidden = false;
    var thead = "<thead><tr><th>Country</th>" + TABLE_METRICS.map(function(m){
      return "<th>" + DATA.metricMeta[m].label + "</th>";
    }).join("") + "</tr></thead>";
    var tbody = "<tbody>" + rows.map(function(r){
      var c = COUNTRIES_BY_ISO[r.iso];
      var cells = TABLE_METRICS.map(function(m){
        return "<td>" + fmtValue(valueAt(r.iso, m, currentYearIdx), m) + "</td>";
      }).join("");
      return '<tr><td class="country-cell"><span class="swatch" style="background:' + SERIES_COLORS_LIVE()[r.slot] + '"></span>' + c.name + '</td>' + cells + '</tr>';
    }).join("") + "</tbody>";
    table.innerHTML = thead + tbody;
  }

}
