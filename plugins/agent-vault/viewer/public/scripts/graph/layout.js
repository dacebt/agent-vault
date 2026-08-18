(function () {
  const VIEW_WIDTH = 960;
  const VIEW_HEIGHT = 600;
  const SETTLING_STEPS = 180;
  const DENSE_NODE_THRESHOLD = 60;
  const SPATIAL_PAIR_THRESHOLD = 220;
  const MAX_FORCE_EDGES = 640;
  const FINAL_COLLISION_SWEEPS = 320;
  const DENSE_FORCE_ATTEMPTS = 5;
  const DENSE_MAX_STEPS = 900;
  const DENSE_STABLE_STEPS = 12;
  const DENSE_MOVEMENT_THRESHOLD = 0.025;
  const DENSE_COOLING = 0.95;
  const TARGET_PACKING_DENSITY = 0.24;
  const WORLD_ASPECT_WIDTH = 8;
  const WORLD_ASPECT_HEIGHT = 5;
  const EPSILON = 0.000001;
  const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));
  const TIERS = Object.freeze({
    spacious: Object.freeze({ name: "spacious", radius: 17, clearance: 4, gap: 8, width: 144, height: 34, font: 13, line: 15, points: 18 }),
    dense: Object.freeze({ name: "dense", radius: 17, clearance: 4, gap: 7, width: 96, height: 28, font: 11, line: 12, points: 15 }),
    compact: Object.freeze({ name: "compact", radius: 17, clearance: 4, gap: 5, width: 64, height: 22, font: 9, line: 10, points: 10 }),
  });
  function compareOrdinal(left, right) { return left === right ? 0 : left < right ? -1 : 1; }
  function compareEdges(left, right) {
    return compareOrdinal(left.source, right.source)
      || compareOrdinal(left.target, right.target)
      || compareOrdinal(finite(Number(left.weight), 1), finite(Number(right.weight), 1));
  }
  function forceEdges(count, edges) { return count <= DENSE_NODE_THRESHOLD ? edges : [...edges].sort(compareEdges).slice(0, MAX_FORCE_EDGES); }
  function labelTier(count) { return count <= 24 ? TIERS.spacious : count <= 60 ? TIERS.dense : TIERS.compact; }
  function footprint(tier) {
    const spacing = tier.name === "compact" ? 7 : 9;
    const mark = tier.radius + tier.clearance;
    const labelTop = tier.radius + tier.gap;
    return {
      left: Math.max(mark, tier.width / 2) + spacing,
      right: Math.max(mark, tier.width / 2) + spacing,
      top: mark + spacing,
      bottom: Math.max(mark, labelTop + tier.height) + spacing,
      labelTop,
    };
  }
  function worldDimensions(count, box) {
    if (count <= DENSE_NODE_THRESHOLD) return { width: VIEW_WIDTH, height: VIEW_HEIGHT };
    const footprintArea = (box.left + box.right) * (box.top + box.bottom);
    const requiredArea = count * footprintArea / TARGET_PACKING_DENSITY;
    const scale = Math.sqrt(Math.max(1, requiredArea / (VIEW_WIDTH * VIEW_HEIGHT)));
    const width = Math.ceil(VIEW_WIDTH * scale / WORLD_ASPECT_WIDTH) * WORLD_ASPECT_WIDTH;
    return { width, height: width / WORLD_ASPECT_WIDTH * WORLD_ASPECT_HEIGHT };
  }
  function enlargedWorld(dimensions) {
    const width = Math.ceil(dimensions.width * 1.18 / WORLD_ASPECT_WIDTH) * WORLD_ASPECT_WIDTH;
    return { width, height: width / WORLD_ASPECT_WIDTH * WORLD_ASPECT_HEIGHT };
  }
  function clamp(value, minimum, maximum) { return Math.min(maximum, Math.max(minimum, value)); }
  function finite(value, fallback) { return Number.isFinite(value) ? value : fallback; }
  function fallbackVector(left, right) {
    const ordinal = ((left.index + 1) * 131 + (right.index + 1) * 197) % 360;
    const angle = ordinal * Math.PI / 180;
    return { x: Math.cos(angle), y: Math.sin(angle) };
  }
  function unitVector(left, right, dx, dy) {
    const distance = Math.hypot(dx, dy);
    if (Number.isFinite(distance) && distance >= EPSILON) {
      return { x: dx / distance, y: dy / distance, distance };
    }
    return { ...fallbackVector(left, right), distance: 0 };
  }
  function initializeStates(nodes, tier, box, width, height) {
    const radialX = (width - box.left - box.right) * 0.38;
    const radialY = (height - box.top - box.bottom) * 0.38;
    return nodes.map((node, index) => {
      const progress = nodes.length === 1 ? 0 : Math.sqrt((index + 0.5) / nodes.length);
      const angle = index * GOLDEN_ANGLE;
      return {
        node,
        index,
        x: clamp(width / 2 + Math.cos(angle) * radialX * progress, box.left, width - box.right),
        y: clamp(height / 2 + Math.sin(angle) * radialY * progress, box.top, height - box.bottom),
        vx: 0,
        vy: 0,
        fx: 0,
        fy: 0,
      };
    });
  }
  function allPairs(states) {
    const pairs = [];
    for (let left = 0; left < states.length; left += 1) {
      for (let right = left + 1; right < states.length; right += 1) pairs.push([left, right]);
    }
    return pairs;
  }
  function bucketPairs(states, tier) {
    const cellSize = Math.max(tier.width + 12, tier.height + tier.radius * 2 + 12, 80);
    const buckets = new Map();
    states.forEach((state, index) => {
      const cellX = Math.floor(state.x / cellSize);
      const cellY = Math.floor(state.y / cellSize);
      const key = `${cellX},${cellY}`;
      if (!buckets.has(key)) buckets.set(key, []);
      buckets.get(key).push(index);
    });
    const cells = [...buckets.keys()].map((key) => key.split(",").map(Number));
    cells.sort((a, b) => a[1] - b[1] || a[0] - b[0]);
    const cellOrder = new Map(cells.map(([x, y], index) => [`${x},${y}`, index]));
    const pairs = [];
    cells.forEach(([cellX, cellY], cellIndex) => {
      const local = buckets.get(`${cellX},${cellY}`);
      for (let offsetY = -2; offsetY <= 2; offsetY += 1) {
        for (let offsetX = -2; offsetX <= 2; offsetX += 1) {
          const neighbor = buckets.get(`${cellX + offsetX},${cellY + offsetY}`);
          if (!neighbor) continue;
          const neighborIndex = cellOrder.get(`${cellX + offsetX},${cellY + offsetY}`);
          if (neighborIndex < cellIndex) continue;
          for (const left of local) {
            for (const right of neighbor) {
              if (left < right) pairs.push([left, right]);
              else if (right < left && neighborIndex > cellIndex) pairs.push([right, left]);
            }
          }
        }
      }
    });
    return pairs.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  }
  function candidatePairs(states, tier) { return states.length <= SPATIAL_PAIR_THRESHOLD ? allPairs(states) : bucketPairs(states, tier); }
  function applyRepulsion(states, pairs, cooling) {
    for (const [leftIndex, rightIndex] of pairs) {
      const left = states[leftIndex];
      const right = states[rightIndex];
      const vector = unitVector(left, right, right.x - left.x, right.y - left.y);
      let strength = Math.min(5.6, 23500 / (vector.distance * vector.distance + 90));
      if (cooling !== undefined) strength *= cooling;
      const forceX = finite(vector.x * strength, 0);
      const forceY = finite(vector.y * strength, 0);
      left.fx -= forceX;
      left.fy -= forceY;
      right.fx += forceX;
      right.fy += forceY;
    }
  }
  function applySprings(links, cooling) {
    for (const { left, right, weight } of links) {
      const vector = unitVector(left, right, right.x - left.x, right.y - left.y);
      const jointRelief = Math.min(32, Math.log2(Math.max(2, left.degree, right.degree)) * 8);
      const restLength = 132 + jointRelief;
      let strength = clamp((vector.distance - restLength) * 0.019 * (0.65 + weight), -4, 4);
      if (cooling !== undefined) strength *= cooling;
      const forceX = finite(vector.x * strength, 0);
      const forceY = finite(vector.y * strength, 0);
      left.fx += forceX;
      left.fy += forceY;
      right.fx -= forceX;
      right.fy -= forceY;
    }
  }
  function clampState(state, box, width, height) {
    state.x = clamp(finite(state.x, width / 2), box.left, width - box.right);
    state.y = clamp(finite(state.y, height / 2), box.top, height - box.bottom);
  }
  function integrate(states, box, width, height, cooling) {
    const centering = cooling === undefined ? 0.0011 : 0.0011 * cooling;
    const damping = cooling === undefined ? 0.76 : 0.64 + 0.12 * cooling;
    for (const state of states) {
      state.fx = finite(state.fx - (state.x - width / 2) * centering, 0);
      state.fy = finite(state.fy - (state.y - height / 2) * centering, 0);
      state.vx = finite((state.vx + state.fx) * damping, 0);
      state.vy = finite((state.vy + state.fy) * damping, 0);
      const speed = Math.hypot(state.vx, state.vy);
      if (!Number.isFinite(speed)) {
        state.vx = 0;
        state.vy = 0;
      } else if (speed > 9) {
        state.vx *= 9 / speed;
        state.vy *= 9 / speed;
      }
      state.x = finite(state.x + state.vx, width / 2);
      state.y = finite(state.y + state.vy, height / 2);
      clampState(state, box, width, height);
      state.fx = 0;
      state.fy = 0;
    }
  }
  function projectCollisions(states, pairs, box, width, height) {
    let moved = false;
    for (const [leftIndex, rightIndex] of pairs) {
      const left = states[leftIndex];
      const right = states[rightIndex];
      const overlapX = box.left + box.right - Math.abs(right.x - left.x);
      const overlapY = box.top + box.bottom - Math.abs(right.y - left.y);
      if (overlapX <= 0 || overlapY <= 0) continue;
      const fallback = fallbackVector(left, right);
      if (overlapX < overlapY) {
        const direction = Math.abs(right.x - left.x) >= EPSILON ? Math.sign(right.x - left.x) : Math.sign(fallback.x) || 1;
        const shift = (overlapX + 0.4) / 2;
        left.x -= direction * shift;
        right.x += direction * shift;
      } else {
        const direction = Math.abs(right.y - left.y) >= EPSILON ? Math.sign(right.y - left.y) : Math.sign(fallback.y) || 1;
        const shift = (overlapY + 0.4) / 2;
        left.y -= direction * shift;
        right.y += direction * shift;
      }
      clampState(left, box, width, height);
      clampState(right, box, width, height);
      moved = true;
    }
    return moved;
  }
  function projectAttraction(links, box, width, height, cooling) {
    const restLength = Math.max(box.left + box.right, box.top + box.bottom) + 60;
    for (const { left, right } of links) {
      const vector = unitVector(left, right, right.x - left.x, right.y - left.y);
      if (vector.distance <= restLength) continue;
      const degree = Math.max(1, left.degree, right.degree);
      let shift = Math.min(3, (vector.distance - restLength) * 0.016) / (2 * degree);
      if (cooling !== undefined) shift *= cooling;
      left.x += vector.x * shift;
      left.y += vector.y * shift;
      right.x -= vector.x * shift;
      right.y -= vector.y * shift;
      clampState(left, box, width, height);
      clampState(right, box, width, height);
    }
  }
  function preparedStates(nodes, selectedEdges, tier, box, width, height) {
    const states = initializeStates(nodes, tier, box, width, height);
    const stateById = new Map(states.map((state) => [state.node.id, state]));
    states.forEach((state) => { state.degree = 0; });
    const links = [];
    for (const edge of selectedEdges) {
      const left = stateById.get(edge.source);
      const right = stateById.get(edge.target);
      if (!left || !right || left === right) continue;
      left.degree += 1;
      right.degree += 1;
      const rawWeight = Number(edge.weight);
      const weight = Math.min(2.4, Math.log1p(clamp(finite(rawWeight, 1), 0, 1000)) / Math.log(4));
      links.push({ left, right, weight });
    }
    return { states, links };
  }
  function settleSmall(nodes, edges, tier, box) {
    const { states, links } = preparedStates(nodes, edges, tier, box, VIEW_WIDTH, VIEW_HEIGHT);
    const pairs = allPairs(states);
    for (let step = 0; step < SETTLING_STEPS; step += 1) {
      applyRepulsion(states, pairs);
      applySprings(links);
      integrate(states, box, VIEW_WIDTH, VIEW_HEIGHT);
      projectAttraction(links, box, VIEW_WIDTH, VIEW_HEIGHT);
      projectCollisions(states, pairs, box, VIEW_WIDTH, VIEW_HEIGHT);
    }
    for (let sweep = 0; sweep < FINAL_COLLISION_SWEEPS; sweep += 1) {
      if (!projectCollisions(states, pairs, box, VIEW_WIDTH, VIEW_HEIGHT)) break;
    }
    states.forEach((state) => clampState(state, box, VIEW_WIDTH, VIEW_HEIGHT));
    return new Map(states.map((state) => [state.node.id, state]));
  }
  function maximumMovement(states, previousX, previousY) {
    let maximum = 0;
    for (let index = 0; index < states.length; index += 1) {
      const state = states[index];
      maximum = Math.max(maximum, Math.hypot(state.x - previousX[index], state.y - previousY[index]));
    }
    return maximum;
  }
  function settleDense(nodes, selectedEdges, tier, box, width, height) {
    const { states, links } = preparedStates(nodes, selectedEdges, tier, box, width, height);
    const previousX = new Float64Array(states.length), previousY = new Float64Array(states.length);
    let stableSteps = 0;
    let maxMovement = Infinity;
    for (let step = 0; step < DENSE_MAX_STEPS; step += 1) {
      for (let index = 0; index < states.length; index += 1) {
        previousX[index] = states[index].x;
        previousY[index] = states[index].y;
      }
      const cooling = Math.pow(DENSE_COOLING, step);
      const pairs = candidatePairs(states, tier);
      applyRepulsion(states, pairs, cooling);
      applySprings(links, cooling);
      integrate(states, box, width, height, cooling);
      projectAttraction(links, box, width, height, cooling);
      const collisionMoved = projectCollisions(states, pairs, box, width, height);
      maxMovement = maximumMovement(states, previousX, previousY);
      stableSteps = !collisionMoved && maxMovement <= DENSE_MOVEMENT_THRESHOLD ? stableSteps + 1 : 0;
      if (stableSteps < DENSE_STABLE_STEPS) continue;
      const positions = new Map(states.map((state) => [state.node.id, state]));
      if (!validPositions(positions, box, width, height)) return null;
      return { positions, stepCount: step + 1, stableSteps, maxMovement };
    }
    return null;
  }
  function validPositions(positions, box, width, height) {
    const states = [...positions.values()];
    if (states.some((state) => (
      !Number.isFinite(state.x) || !Number.isFinite(state.y)
      || state.x < box.left || state.x > width - box.right
      || state.y < box.top || state.y > height - box.bottom
    ))) return false;
    for (let left = 0; left < states.length; left += 1) {
      for (let right = left + 1; right < states.length; right += 1) {
        const separatedX = Math.abs(states[right].x - states[left].x) >= box.left + box.right;
        const separatedY = Math.abs(states[right].y - states[left].y) >= box.top + box.bottom;
        if (!separatedX && !separatedY) return false;
      }
    }
    return true;
  }
  function settle(nodes, edges) {
    const tier = labelTier(nodes.length);
    const box = footprint(tier);
    let dimensions = worldDimensions(nodes.length, box);
    if (nodes.length <= DENSE_NODE_THRESHOLD) {
      return {
        positions: settleSmall(nodes, edges, tier, box),
        tier: Object.freeze({ ...tier }),
        box: Object.freeze({ ...box }),
        width: dimensions.width,
        height: dimensions.height,
      };
    }
    const selectedEdges = forceEdges(nodes.length, edges);
    for (let attempt = 0; attempt < DENSE_FORCE_ATTEMPTS; attempt += 1) {
      const result = settleDense(nodes, selectedEdges, tier, box, dimensions.width, dimensions.height);
      if (result) {
        return {
          positions: result.positions,
          tier: Object.freeze({ ...tier }),
          box: Object.freeze({ ...box }),
          width: dimensions.width,
          height: dimensions.height,
          convergence: Object.freeze({
            attempt: attempt + 1,
            stepCount: result.stepCount,
            stableSteps: result.stableSteps,
            maxMovement: result.maxMovement,
            threshold: DENSE_MOVEMENT_THRESHOLD,
            forceEdgeCount: selectedEdges.length,
            inputEdgeCount: edges.length,
          }),
        };
      }
      dimensions = enlargedWorld(dimensions);
    }
    throw new Error(`graphLayout dense force did not converge after ${DENSE_FORCE_ATTEMPTS} bounded attempts.`);
  }
  window.graphLayout = Object.freeze({ compareOrdinal, settle });
})();
