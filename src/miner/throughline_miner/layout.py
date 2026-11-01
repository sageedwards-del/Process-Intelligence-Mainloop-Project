"""Left-to-right layered layout for pm4py BPMN graphs.

bpmn-js only renders models that carry BPMN diagram interchange (DI): node bounds and edge
waypoints. pm4py's own layouter shells out to the Graphviz `dot` binary, which would add a
system dependency to the image. Models from the Inductive Miner are block-structured, so a
small Sugiyama-style layout is enough:

1. Break cycles: edges that close a loop (DFS back edges) are set aside.
2. Layering: each node's column is its longest path from a source; end events go last.
3. Dummies: an edge that spans several columns gets a virtual node in each column it
   crosses, so it reserves a row there instead of running through a task.
4. Ordering: barycenter sweeps reduce crossings within columns.
5. Coordinates: columns left to right, each column centred vertically.
6. Routing: forward edges are orthogonal and pass through their dummies; splits leave a
   gateway from its top/bottom and joins enter it the same way; loop-back edges run in a
   lane above or below the diagram.
"""

from __future__ import annotations

from collections import defaultdict
from dataclasses import dataclass
from itertools import pairwise
from typing import Any

from pm4py.objects.bpmn.obj import BPMN

TASK_SIZE = (100, 80)
EVENT_SIZE = (36, 36)
GATEWAY_SIZE = (50, 50)
COLUMN_GAP = 60
ROW_HEIGHT = 110
MARGIN = 40
LOOP_LANE_GAP = 25
SWEEPS = 6

Vertex = Any  # a pm4py BPMN node (untyped) or a _Dummy
Point = tuple[float, float]


class _Dummy:
    """A virtual vertex where a long edge crosses a column."""

    __slots__ = ("key",)

    def __init__(self, key: str) -> None:
        self.key = key


@dataclass(frozen=True)
class _Box:
    x: float
    y: float
    w: float
    h: float

    @property
    def cx(self) -> float:
        return self.x + self.w / 2

    @property
    def cy(self) -> float:
        return self.y + self.h / 2


def apply_layout(bpmn: BPMN) -> BPMN:
    """Write node bounds and edge waypoints into `bpmn`'s layout, in place."""
    # pm4py keeps nodes and flows in sets; sort them so the layout is deterministic.
    nodes: list[Vertex] = sorted(bpmn.get_nodes(), key=lambda n: (_rank_hint(n), n.get_id()))
    flows = sorted(bpmn.get_flows(), key=lambda f: str(f.get_id()))
    if not nodes:
        return bpmn

    succ: dict[Vertex, list[Vertex]] = defaultdict(list)
    for f in flows:
        succ[f.get_source()].append(f.get_target())
    back_edges = _back_edges(nodes, succ)
    forward = [
        f
        for f in flows
        if (f.get_source(), f.get_target()) not in back_edges
        and f.get_source() is not f.get_target()
    ]

    layer = _longest_path_layers(nodes, forward)
    chains, vertices = _insert_dummies(nodes, forward, layer)
    columns = _order_columns(vertices, layer, chains)
    boxes, row_of = _place(columns)

    routes: dict[Any, list[Point]] = {}
    for f in forward:
        routes[f] = _route_forward(chains[f], boxes)
    top = min(b.y for b in boxes.values())
    bottom = max(b.y + b.h for b in boxes.values())
    lanes = {"top": 0, "bottom": 0}
    for f in flows:
        if f in routes:
            continue
        s, t = f.get_source(), f.get_target()
        side = "top" if row_of[s] <= 0 else "bottom"
        lanes[side] += 1
        lane_y = (
            top - lanes[side] * LOOP_LANE_GAP
            if side == "top"
            else bottom + lanes[side] * LOOP_LANE_GAP
        )
        routes[f] = _route_back(boxes[s], boxes[t], lane_y, side, self_loop=s is t)

    _write(bpmn, nodes, boxes, routes)
    return bpmn


# --- graph steps -------------------------------------------------------------------------


def _rank_hint(n: Vertex) -> int:
    # Start events first so DFS (and therefore back-edge detection) begins at the start.
    if isinstance(n, BPMN.StartEvent):
        return 0
    if isinstance(n, BPMN.EndEvent):
        return 2
    return 1


def _size(n: Vertex) -> tuple[int, int]:
    if isinstance(n, BPMN.StartEvent | BPMN.EndEvent):
        return EVENT_SIZE
    if isinstance(n, BPMN.Gateway):
        return GATEWAY_SIZE
    return TASK_SIZE


def _back_edges(nodes: list[Vertex], succ: dict[Vertex, list[Vertex]]) -> set[tuple[Any, Any]]:
    """Edges into a node that is still on the DFS stack (iterative, no recursion limit)."""
    state: dict[Vertex, int] = {}  # 1 = on stack, 2 = done
    back: set[tuple[Any, Any]] = set()
    for root in nodes:
        if root in state:
            continue
        state[root] = 1
        stack = [(root, iter(succ[root]))]
        while stack:
            node, children = stack[-1]
            child = next(children, None)
            if child is None:
                state[node] = 2
                stack.pop()
            elif state.get(child) == 1:
                back.add((node, child))
            elif child not in state:
                state[child] = 1
                stack.append((child, iter(succ[child])))
    return back


def _longest_path_layers(nodes: list[Vertex], forward: list[Any]) -> dict[Vertex, int]:
    succ: dict[Vertex, list[Vertex]] = defaultdict(list)
    indegree = dict.fromkeys(nodes, 0)
    for f in forward:
        succ[f.get_source()].append(f.get_target())
        indegree[f.get_target()] += 1
    queue = [n for n in nodes if indegree[n] == 0]
    layer = dict.fromkeys(nodes, 0)
    i = 0
    while i < len(queue):
        n = queue[i]
        i += 1
        for t in succ[n]:
            layer[t] = max(layer[t], layer[n] + 1)
            indegree[t] -= 1
            if indegree[t] == 0:
                queue.append(t)
    # End events sit in the last column, so every path finishes on the right.
    last = max(layer.values())
    for n in nodes:
        if isinstance(n, BPMN.EndEvent):
            layer[n] = last
    return layer


def _insert_dummies(
    nodes: list[Vertex], forward: list[Any], layer: dict[Vertex, int]
) -> tuple[dict[Any, list[Vertex]], list[Vertex]]:
    """Split every forward edge into one-column hops. Returns the chain per flow."""
    chains: dict[Any, list[Vertex]] = {}
    vertices = list(nodes)
    for f in forward:
        s, t = f.get_source(), f.get_target()
        chain = [s]
        for col in range(layer[s] + 1, layer[t]):
            d = _Dummy(f"{f.get_id()}:{col}")
            layer[d] = col
            vertices.append(d)
            chain.append(d)
        chain.append(t)
        chains[f] = chain
    return chains, vertices


def _order_columns(
    vertices: list[Vertex], layer: dict[Vertex, int], chains: dict[Any, list[Vertex]]
) -> list[list[Vertex]]:
    pred: dict[Vertex, list[Vertex]] = defaultdict(list)
    succ: dict[Vertex, list[Vertex]] = defaultdict(list)
    for chain in chains.values():
        for a, b in pairwise(chain):
            succ[a].append(b)
            pred[b].append(a)

    columns: list[list[Vertex]] = [[] for _ in range(max(layer.values()) + 1)]
    for v in vertices:
        columns[layer[v]].append(v)

    pos: dict[Vertex, float] = {}

    def assign(col: list[Vertex]) -> None:
        for i, v in enumerate(col):
            pos[v] = i - (len(col) - 1) / 2

    def sweep(cols: list[list[Vertex]], neighbours: dict[Vertex, list[Vertex]]) -> None:
        for col in cols:
            current = {v: pos[v] for v in col}
            for v in col:
                linked = [pos[m] for m in neighbours[v]]
                current[v] = sum(linked) / len(linked) if linked else current[v]
            col.sort(key=lambda v: current[v])  # stable: ties keep their order
            assign(col)

    for col in columns:
        assign(col)
    for _ in range(SWEEPS):
        sweep(columns[1:], pred)
        sweep(list(reversed(columns[:-1])), succ)
    return columns


# --- geometry ----------------------------------------------------------------------------


def _place(columns: list[list[Vertex]]) -> tuple[dict[Vertex, _Box], dict[Vertex, float]]:
    """Boxes for real nodes; a dummy's box is a zero-height strip across its column."""
    boxes: dict[Vertex, _Box] = {}
    row_of: dict[Vertex, float] = {}
    x = 0.0
    for col in columns:
        real = [v for v in col if not isinstance(v, _Dummy)]
        col_width = max((_size(v)[0] for v in real), default=EVENT_SIZE[0])
        for i, v in enumerate(col):
            row = i - (len(col) - 1) / 2
            cy = row * ROW_HEIGHT
            row_of[v] = row
            if isinstance(v, _Dummy):
                boxes[v] = _Box(x, cy, col_width, 0)
            else:
                w, h = _size(v)
                boxes[v] = _Box(x + (col_width - w) / 2, cy - h / 2, w, h)
        x += col_width + COLUMN_GAP
    return boxes, row_of


def _route_forward(chain: list[Vertex], boxes: dict[Vertex, _Box]) -> list[Point]:
    s, t = chain[0], chain[-1]
    sb = boxes[s]
    first = boxes[chain[1]]
    if isinstance(s, BPMN.Gateway) and first.cy != sb.cy:
        # A split leaves the gateway from its top or bottom corner.
        corner_y = sb.y + sb.h if first.cy > sb.cy else sb.y
        points: list[Point] = [(sb.cx, corner_y), (sb.cx, first.cy)]
    else:
        points = [(sb.x + sb.w, sb.cy)]

    for v in chain[1:]:
        b = boxes[v]
        cur_y = points[-1][1]
        if v is t and isinstance(t, BPMN.Gateway) and cur_y != b.cy:
            # A join enters the gateway from its top or bottom corner.
            corner_y = b.y if cur_y < b.cy else b.y + b.h
            points += [(b.cx, cur_y), (b.cx, corner_y)]
            break
        if cur_y != b.cy:
            elbow_x = b.x - COLUMN_GAP / 2
            points += [(elbow_x, cur_y), (elbow_x, b.cy)]
        points.append((b.x, b.cy))
        if isinstance(v, _Dummy):
            points.append((b.x + b.w, b.cy))
    return _simplify(points)


def _route_back(sb: _Box, tb: _Box, lane_y: float, side: str, self_loop: bool) -> list[Point]:
    s_edge = sb.y if side == "top" else sb.y + sb.h
    t_edge = tb.y if side == "top" else tb.y + tb.h
    if self_loop:
        sx, tx = sb.x + sb.w * 0.75, sb.x + sb.w * 0.25
    else:
        sx, tx = sb.cx, tb.cx
    return [(sx, s_edge), (sx, lane_y), (tx, lane_y), (tx, t_edge)]


def _simplify(points: list[Point]) -> list[Point]:
    """Drop repeated points and middle points of straight runs."""
    out: list[Point] = []
    for p in points:
        if out and p == out[-1]:
            continue
        if len(out) >= 2:
            (ax, ay), (bx, by) = out[-2], out[-1]
            if (ax == bx == p[0]) or (ay == by == p[1]):
                out[-1] = p
                continue
        out.append(p)
    return out


def _write(
    bpmn: BPMN,
    nodes: list[Vertex],
    boxes: dict[Vertex, _Box],
    routes: dict[Any, list[Point]],
) -> None:
    """Shift everything to positive coordinates and store it on the BPMN layout."""
    xs = [boxes[n].x for n in nodes] + [p[0] for r in routes.values() for p in r]
    ys = [boxes[n].y for n in nodes] + [p[1] for r in routes.values() for p in r]
    dx, dy = MARGIN - min(xs), MARGIN - min(ys)

    layout = bpmn.get_layout()
    for n in nodes:
        b = boxes[n]
        nl = layout.get(n)
        nl.set_x(round(b.x + dx))
        nl.set_y(round(b.y + dy))
        nl.set_width(round(b.w))
        nl.set_height(round(b.h))
    for f, points in routes.items():
        edge = layout.get(f)
        edge.del_waypoints()
        for px, py in points:
            edge.add_waypoint((round(px + dx), round(py + dy)))
