(() => {
  const byId = (id) => document.getElementById(id);
  const components = new Map();
  const edges = [];
  for (const item of document.querySelectorAll("#components > li")) {
    const source = item.querySelector(".source");
    components.set(item.id, {
      id: item.id,
      title: item.querySelector("h3").textContent,
      layer: item.dataset.layer,
      summary: item.querySelector("p").textContent,
      source: source.href,
      position: item.dataset.position.split(",").map(Number),
    });
    for (const link of item.querySelectorAll(".relations a")) {
      edges.push({
        from: item.id,
        to: link.hash.slice(1),
        relationship: link.parentElement.firstChild.textContent.trim(),
      });
    }
  }

  // Traces name edges explicitly because export and restore run in opposite directions.
  const traces = {
    all: {
      note: "Select a component to see what it produces and what consumes it.",
    },
    source: {
      path: ["source", "captures", "workspace", "report"],
      note: "A reviewer chooses which snapshot supports a claim. Retaining its bytes alone does not establish what they prove.",
    },
    chain: {
      path: ["chain", "captures", "workspace", "report"],
      note: "Check the chain, block and request inputs before citing a provider observation in the memo.",
    },
    restore: {
      path: ["workspace", "packet", "workspace", "compare"],
      note: "Export the original, restore it into a new directory, then compare both cases. Private packets stay on the operator’s machine.",
    },
  };
  const plot = byId("plot");
  const lines = byId("lines");
  const route = byId("route");
  const buttons = new Map();
  let chosen = components.has(location.hash.slice(1))
    ? location.hash.slice(1)
    : "workspace";
  let yaw = 0;
  let pitch = 0;
  let dragging = null;
  let viewNodes;
  let viewEdges;
  const svg = (type) =>
    document.createElementNS("http://www.w3.org/2000/svg", type);

  // A second starting layout leaves room for all eight labels on narrow screens.
  const narrow = {
    profiles: [-130, -118, -18],
    source: [-130, -58, 20],
    chain: [130, -88, -20],
    captures: [-120, 5, 15],
    workspace: [130, -26, -10],
    report: [130, 35, 10],
    packet: [-120, 80, 3],
    compare: [130, 112, 5],
  };

  function renderProjection() {
    const { width, height } = plot.getBoundingClientRect();
    const horizontal =
      width < 560
        ? Math.max(0, width - 130) / 260
        : Math.max(0, width - 165) / 390;
    const vertical = Math.max(0, height - 82) / 260;
    const positions = new Map();
    for (const node of viewNodes) {
      const [x, y, z] = width < 560 ? narrow[node.id] : node.position;
      const rx = x * Math.cos(yaw) + z * Math.sin(yaw);
      const rz = z * Math.cos(yaw) - x * Math.sin(yaw);
      const ry = y * Math.cos(pitch) - rz * Math.sin(pitch);
      const depth = y * Math.sin(pitch) + rz * Math.cos(pitch);
      const perspective = 670 / (670 - depth);
      const button = buttons.get(node.id);
      const halfWidth = button.offsetWidth / 2;
      const px = Math.max(
        halfWidth + 3,
        Math.min(
          width - halfWidth - 3,
          width / 2 + rx * horizontal * perspective,
        ),
      );
      const py = Math.max(
        22,
        Math.min(height - 22, height / 2 + ry * vertical * perspective),
      );
      button.style.left = px + "px";
      button.style.top = py + "px";
      button.style.zIndex = String(Math.round(depth) + 300);
      positions.set(node.id, [px, py]);
    }
    lines.replaceChildren();
    for (const edge of viewEdges) {
      const [x1, y1] = positions.get(edge.from);
      const [x2, y2] = positions.get(edge.to);
      // Parallel directed edges bend apart so the restore loop remains visible.
      const dx = x2 - x1;
      const dy = y2 - y1;
      const length = Math.max(1, Math.hypot(dx, dy));
      const bend = 22;
      const midX = (x1 + x2) / 2 - (dy * bend) / length;
      const midY = (y1 + y2) / 2 + (dx * bend) / length;
      const active = edge.from === chosen || edge.to === chosen;
      const path = svg("path");
      path.setAttribute("d", `M ${x1} ${y1} Q ${midX} ${midY} ${x2} ${y2}`);
      path.setAttribute("class", active ? "edge active" : "edge");
      const tipX = (x1 + 2 * midX + x2) / 4;
      const tipY = (y1 + 2 * midY + y2) / 4;
      const arrow = svg("path");
      arrow.setAttribute("d", "M -5 -3 L 2 0 L -5 3");
      arrow.setAttribute(
        "transform",
        `translate(${tipX} ${tipY}) rotate(${(Math.atan2(dy, dx) * 180) / Math.PI})`,
      );
      arrow.setAttribute("class", active ? "edge active" : "edge");
      lines.append(path, arrow);
    }
  }

  function select(id, writeHash = true) {
    chosen = id;
    const node = components.get(id);
    byId("layer").textContent = node.layer;
    byId("selection").textContent = node.title;
    byId("summary").textContent = node.summary;
    byId("code").href = node.source;
    for (const [key, button] of buttons) {
      button.setAttribute("aria-pressed", String(key === id));
    }
    const neighbors = byId("neighbors");
    neighbors.replaceChildren();
    for (const edge of viewEdges.filter(
      (edge) => edge.from === id || edge.to === id,
    )) {
      const outgoing = edge.from === id;
      const other = outgoing ? edge.to : edge.from;
      const button = document.createElement("button");
      button.type = "button";
      button.textContent =
        (outgoing ? "To " : "From ") + components.get(other).title;
      button.setAttribute(
        "aria-label",
        components.get(edge.from).title +
          " " +
          edge.relationship +
          " " +
          components.get(edge.to).title,
      );
      button.onclick = () => {
        select(other);
        buttons.get(other).focus({ preventScroll: true });
      };
      const li = document.createElement("li");
      li.append(button);
      neighbors.append(li);
    }
    if (writeHash) {
      try {
        history.replaceState(null, "", "#" + id);
      } catch {
        /* File viewers may restrict history updates. */
      }
    }
    renderProjection();
  }

  function graphData() {
    return {
      data: {
        graph: {
          trace: route.value,
          nodes: viewNodes.map(({ position, ...node }) => node),
          edges: viewEdges,
        },
      },
    };
  }

  function setTrace(writeHash = true) {
    const trace = traces[route.value];
    viewNodes = [...components.values()].filter(
      (node) => !trace.path || trace.path.includes(node.id),
    );
    viewEdges = edges.filter(
      (edge) =>
        !trace.path ||
        trace.path.some(
          (id, index) => id === edge.from && trace.path[index + 1] === edge.to,
        ),
    );
    for (const [id, button] of buttons) {
      button.hidden = !viewNodes.some((node) => node.id === id);
    }
    const selected = viewNodes.find((node) => node.id === chosen);
    select(selected?.id || trace.path[0], writeHash);
    byId("trace-note").textContent = trace.note;
    byId("json").textContent = JSON.stringify(graphData(), null, 2);
  }

  for (const node of components.values()) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "node";
    button.textContent = node.title;
    button.setAttribute("aria-controls", "selection summary");
    button.onclick = () => select(node.id);
    buttons.set(node.id, button);
    plot.append(button);
  }
  function rotate(x, y) {
    yaw += x;
    pitch = Math.max(-1, Math.min(1, pitch + y));
    renderProjection();
  }
  plot.addEventListener("keydown", (event) => {
    const direction = {
      ArrowLeft: [-0.14, 0],
      ArrowRight: [0.14, 0],
      ArrowUp: [0, -0.12],
      ArrowDown: [0, 0.12],
    }[event.key];
    if (direction) {
      event.preventDefault();
      rotate(...direction);
    }
  });
  plot.addEventListener("pointerdown", (event) => {
    if (
      !event.isPrimary ||
      event.button !== 0 ||
      event.target.closest("button")
    )
      return;
    plot.setPointerCapture(event.pointerId);
    dragging = [event.clientX, event.clientY];
  });
  plot.addEventListener("pointermove", (event) => {
    if (!dragging || !plot.hasPointerCapture(event.pointerId)) return;
    const [x, y] = dragging;
    dragging = [event.clientX, event.clientY];
    rotate((event.clientX - x) / 150, (event.clientY - y) / 180);
  });
  plot.addEventListener("lostpointercapture", () => {
    dragging = null;
  });
  byId("reset").onclick = () => {
    yaw = 0;
    pitch = 0;
    renderProjection();
  };
  route.onchange = () => {
    if (traces[route.value].path) chosen = traces[route.value].path[0];
    setTrace();
  };
  byId("save").onclick = () => {
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(graphData(), null, 2) + "\n"], {
        type: "application/json",
      }),
    );
    const download = document.createElement("a");
    download.href = url;
    download.download = "rea-diligence-" + route.value + ".json";
    download.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  window.addEventListener("hashchange", () => {
    const id = location.hash.slice(1);
    if (!components.has(id)) return;
    if (!viewNodes.some((node) => node.id === id)) route.value = "all";
    chosen = id;
    setTrace(false);
  });
  byId("explorer").hidden = false;
  setTrace(false);
  if (typeof ResizeObserver === "function")
    new ResizeObserver(renderProjection).observe(plot);
  else window.addEventListener("resize", renderProjection);
})();
