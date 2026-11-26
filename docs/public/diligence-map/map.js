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
    source: [-130, -118, 0],
    chain: [130, -118, -7],
    captures: [-113, -54, 6],
    profiles: [130, -54, -13],
    workspace: [0, 8, 10],
    report: [-130, 74, -10],
    packet: [130, 72, 10],
    compare: [0, 124, 3],
  };

  const constrain = (n, low, high) => Math.max(low, Math.min(high, n));

  function renderProjection() {
    const { width, height } = plot.getBoundingClientRect();
    if (!width || !height) return;
    const small = width < 560;
    const horizontal = small ? (width - 148) / 260 : (width - 175) / 390;
    const vertical = (height - 80) / 260;
    const project = (x, y, z) => {
      const rx = x * Math.cos(yaw) + z * Math.sin(yaw);
      const rz = z * Math.cos(yaw) - x * Math.sin(yaw);
      const ry = y * Math.cos(pitch) - rz * Math.sin(pitch);
      const depth = y * Math.sin(pitch) + rz * Math.cos(pitch);
      const scale = 670 / (670 - depth);
      return {
        x: width / 2 + rx * horizontal * scale,
        y: height / 2 + ry * vertical * scale,
        depth,
      };
    };

    // The reference plane uses the same camera as the evidence nodes.
    const floor = byId("floor");
    const floorPath = svg("path");
    const segments = [];
    for (let i = -4; i <= 4; i++) {
      for (const segment of [
        [project(48 * i, 92, -170), project(48 * i, 92, 170)],
        [project(-192, 92, 42 * i), project(192, 92, 42 * i)],
      ]) {
        const [a, b] = segment;
        segments.push(`M ${a.x} ${a.y} L ${b.x} ${b.y}`);
      }
    }
    floorPath.setAttribute("d", segments.join(" "));
    floor.replaceChildren(floorPath);

    const placed = [];
    let congested = false;
    const positions = new Map();
    const guides = byId("guides");
    guides.replaceChildren();
    for (const node of viewNodes) {
      const [worldX, worldY, worldZ] = small ? narrow[node.id] : node.position;
      const anchor = project(worldX, worldY, worldZ);
      if (node.id === chosen) {
        const foot = project(worldX, 92, worldZ);
        const stem = svg("path"),
          ring = svg("ellipse");
        stem.setAttribute("class", "stem");
        stem.setAttribute(
          "d",
          `M ${anchor.x} ${anchor.y} L ${foot.x} ${foot.y}`,
        );
        ring.setAttribute("class", "foot");
        ring.setAttribute("cx", foot.x);
        ring.setAttribute("cy", foot.y);
        ring.setAttribute("rx", "9");
        ring.setAttribute("ry", "3.5");
        floor.append(stem, ring);
      }
      const button = buttons.get(node.id);
      const w = button.offsetWidth;
      const h = button.offsetHeight;
      const idealX = constrain(anchor.x, w / 2 + 4, width - w / 2 - 4);
      const idealY = constrain(anchor.y, h / 2 + 4, height - h / 2 - 4);
      // Nearest free rectangle can occur at an edge of a previously placed label.
      const xs = [idealX, w / 2 + 4, width - w / 2 - 4],
        ys = [idealY, h / 2 + 4, height - h / 2 - 4];
      for (const box of placed) {
        const dx = (box.w + w) / 2 + 5,
          dy = (box.h + h) / 2 + 5;
        xs.push(box.x - dx, box.x + dx);
        ys.push(box.y - dy, box.y + dy);
      }
      let best = Infinity,
        x = idealX,
        y = idealY;
      for (const cx of xs)
        for (const cy of ys) {
          if (
            cx < w / 2 + 3 ||
            cx > width - w / 2 - 3 ||
            cy < h / 2 + 3 ||
            cy > height - h / 2 - 3
          )
            continue;
          const cost = (cx - idealX) ** 2 + (cy - idealY) ** 2;
          if (
            cost >= best ||
            placed.some(
              (r) =>
                Math.abs(cx - r.x) < (w + r.w) / 2 + 4 &&
                Math.abs(cy - r.y) < (h + r.h) / 2 + 4,
            )
          )
            continue;
          best = cost;
          x = cx;
          y = cy;
        }
      congested ||= !Number.isFinite(best);
      const ax = constrain(anchor.x, 4, width - 4),
        ay = constrain(anchor.y, 4, height - 4);
      positions.set(node.id, [ax, ay]);
      placed.push({ x, y, w, h, ax, ay, button, depth: anchor.depth });
    }
    if (congested) {
      // Edge-on views can put every projection on a single line. Pack labels
      // into rows while preserving the actual anchors and their leader lines.
      const columns = Math.max(
        1,
        Math.min(
          placed.length,
          Math.floor(width / (Math.max(...placed.map((r) => r.w)) + 7)),
        ),
      );
      const rows = Math.ceil(placed.length / columns);
      const sorted = [...placed].sort((a, b) => a.ay - b.ay);
      for (let r = 0; r < rows; r++) {
        const row = sorted
          .slice(r * columns, (r + 1) * columns)
          .sort((a, b) => a.ax - b.ax);
        row.forEach((box, i) => {
          box.x = (width * (i + 0.5)) / row.length;
          box.y = (height * (r + 0.5)) / rows;
        });
      }
    }
    for (const { x, y, w, h, ax, ay, button, depth } of placed) {
      button.style.left = x + "px";
      button.style.top = y + "px";
      button.style.zIndex = String(Math.round(depth) + 300);
      if (Math.abs(x - ax) > w / 2 || Math.abs(y - ay) > h / 2) {
        const leader = svg("path"),
          dot = svg("circle");
        leader.setAttribute("class", "guide");
        leader.setAttribute("d", `M ${ax} ${ay} L ${x} ${y}`);
        dot.setAttribute("class", "anchor");
        dot.setAttribute("cx", ax);
        dot.setAttribute("cy", ay);
        dot.setAttribute("r", "3");
        guides.append(leader, dot);
      }
    }
    const flows = byId("flows");
    flows.replaceChildren();
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
      flows.append(path, arrow);
    }
  }

  function select(id, writeHash = true) {
    chosen = id;
    const node = components.get(id);
    byId("current").textContent = node.title;
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
      const direction = document.createElement("span");
      direction.className = "direction";
      direction.textContent = outgoing ? "To →" : "From";
      button.append(direction, components.get(other).title);
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
    const steps = byId("trace-steps");
    steps.hidden = !trace.path;
    steps.replaceChildren();
    for (const id of trace.path || []) {
      const item = document.createElement("li");
      item.textContent = components.get(id).title;
      steps.append(item);
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
    button.dataset.layer = node.layer;
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
  document.querySelector(".inspect-jump").onclick = (event) => {
    event.preventDefault();
    byId("inspector").focus();
    byId("inspector").scrollIntoView({ block: "start" });
  };
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
