/* eslint-disable */
import { useState, useCallback, useRef, useEffect } from "react";

const SIZE_CLASSES = [8, 16, 32, 64, 128, 256, 512, 1024];
const THREAD_CACHE_MAX = 16;
const NUM_THREADS = 4;

interface ThreadCache {
  blocks: number[];
  count: number;
}

interface FreeListState {
  count: number;
  totalCapacity: number;
}

interface AllocEvent {
  threadId: number;
  size: number;
  action: "alloc" | "dealloc";
  source: "cache" | "freelist" | "newslab";
  casRetries: number;
}

interface LogEntry {
  message: string;
  type: "hit" | "miss" | "cas" | "slab" | "info" | "dealloc";
}

interface Stats {
  totalAllocs: number;
  totalDeallocs: number;
  cacheHits: number;
  cacheMisses: number;
  casRetries: number;
  slabsCreated: number;
}

interface AllocatorState {
  threadCaches: ThreadCache[];
  freeLists: FreeListState[];
  stats: Stats;
  lastEvent: AllocEvent | null;
}

function createInitialState(): AllocatorState {
  return {
    threadCaches: Array.from({ length: NUM_THREADS }, () => ({
      blocks: [],
      count: 0,
    })),
    freeLists: SIZE_CLASSES.map(s => ({
      count: Math.floor(65536 / s),
      totalCapacity: Math.floor(65536 / s),
    })),
    stats: {
      totalAllocs: 0,
      totalDeallocs: 0,
      cacheHits: 0,
      cacheMisses: 0,
      casRetries: 0,
      slabsCreated: 1,
    },
    lastEvent: null,
  };
}

function getSizeClassIndex(size: number): number {
  for (let i = 0; i < SIZE_CLASSES.length; i++) {
    if (size <= SIZE_CLASSES[i]) return i;
  }
  return -1;
}

function roundUp(size: number): number {
  const idx = getSizeClassIndex(size);
  return idx === -1 ? size : SIZE_CLASSES[idx];
}

function simulateAlloc(
  state: AllocatorState,
  threadId: number,
  size: number,
  logs: LogEntry[]
): AllocatorState {
  const s = JSON.parse(JSON.stringify(state)) as AllocatorState;
  const idx = getSizeClassIndex(size);
  const rounded = roundUp(size);

  if (idx === -1) {
    logs.push({ message: `T${threadId}: ${size}b too large, using malloc`, type: "info" });
    return s;
  }

  s.stats.totalAllocs++;

  if (s.threadCaches[threadId].count > 0) {
    s.threadCaches[threadId].blocks.pop();
    s.threadCaches[threadId].count--;
    s.stats.cacheHits++;
    logs.push({
      message: `T${threadId}: alloc ${rounded}b -> CACHE HIT (no atomic)`,
      type: "hit"
    });
    s.lastEvent = { threadId, size: rounded, action: "alloc", source: "cache", casRetries: 0 };
    return s;
  }

  s.stats.cacheMisses++;
  const retries = Math.floor(Math.random() * 3);
  s.stats.casRetries += retries;

  if (s.freeLists[idx].count > 0) {
    s.freeLists[idx].count--;
    const refill = Math.min(8, s.freeLists[idx].count);
    s.freeLists[idx].count -= refill;
    s.threadCaches[threadId].count = refill;
    s.threadCaches[threadId].blocks = Array(refill).fill(rounded);

    if (retries > 0) {
      logs.push({
        message: `T${threadId}: alloc ${rounded}b -> MISS -> CAS (${retries} retries) -> got block`,
        type: "cas"
      });
    } else {
      logs.push({
        message: `T${threadId}: alloc ${rounded}b -> MISS -> CAS ok -> cache refilled (${refill})`,
        type: "miss"
      });
    }
    s.lastEvent = { threadId, size: rounded, action: "alloc", source: "freelist", casRetries: retries };
  } else {
    s.stats.slabsCreated++;
    const newBlocks = Math.floor(65536 / rounded);
    s.freeLists[idx].count += newBlocks;
    s.freeLists[idx].totalCapacity += newBlocks;
    logs.push({
      message: `T${threadId}: alloc ${rounded}b -> NEW SLAB (${newBlocks} blocks)`,
      type: "slab"
    });
    s.lastEvent = { threadId, size: rounded, action: "alloc", source: "newslab", casRetries: 0 };
  }

  return s;
}

function simulateDealloc(
  state: AllocatorState,
  threadId: number,
  size: number,
  logs: LogEntry[]
): AllocatorState {
  const s = JSON.parse(JSON.stringify(state)) as AllocatorState;
  const idx = getSizeClassIndex(size);
  const rounded = roundUp(size);

  if (idx === -1) return s;

  s.stats.totalDeallocs++;

  if (s.threadCaches[threadId].count < THREAD_CACHE_MAX) {
    s.threadCaches[threadId].blocks.push(rounded);
    s.threadCaches[threadId].count++;
    logs.push({
      message: `T${threadId}: dealloc ${rounded}b -> THREAD CACHE`,
      type: "dealloc"
    });
  } else {
    s.freeLists[idx].count++;
    logs.push({
      message: `T${threadId}: dealloc ${rounded}b -> cache full -> CAS to FREE LIST`,
      type: "cas"
    });
  }

  s.lastEvent = { threadId, size: rounded, action: "dealloc", source: "cache", casRetries: 0 };
  return s;
}

// ── Thread Cache Bar ───────────────────────────────────
function ThreadCacheBar({ threadId, cache, isActive }: {
  threadId: number;
  cache: ThreadCache;
  isActive: boolean;
}) {
  return (
    <div className={`p-2 sm:p-3 rounded-lg border transition-all duration-300 ${
      isActive
        ? "border-green-400 bg-green-900/20 shadow-lg shadow-green-500/20"
        : "border-green-900 bg-[#0d1a0d]"
    }`}>
      <div className="flex items-center justify-between mb-1.5">
        <span className={`text-xs font-bold ${isActive ? "text-green-300" : "text-green-600"}`}>
          Thread {threadId}
        </span>
        <span className="text-xs text-green-700">
          {cache.count}/{THREAD_CACHE_MAX}
        </span>
      </div>
      <div className="flex gap-px">
        {Array.from({ length: THREAD_CACHE_MAX }).map((_, i) => (
          <div
            key={i}
            className={`h-4 sm:h-5 flex-1 rounded-sm transition-all duration-200 ${
              i < cache.count
                ? "bg-green-500 shadow-sm shadow-green-500/50"
                : "bg-green-950 border border-green-900/50"
            }`}
          />
        ))}
      </div>
      <p className="mt-1 text-xs text-green-800 truncate">
        {cache.count === 0
          ? "empty - CAS needed"
          : cache.count === THREAD_CACHE_MAX
          ? "full - next dealloc to free list"
          : "ready - local alloc"}
      </p>
    </div>
  );
}

// ── Free List Bar ──────────────────────────────────────
function FreeListBar({ size, freeList }: {
  size: number;
  freeList: FreeListState;
}) {
  const displayBlocks = 30;
  const filledBlocks = Math.round(
    (freeList.count / Math.max(freeList.totalCapacity, 1)) * displayBlocks
  );

  return (
    <div className="flex items-center gap-2 py-1 border-b border-green-950">
      <span className="text-xs text-green-700 w-10 sm:w-12 text-right shrink-0">{size}b</span>
      <div className="flex gap-px flex-1 min-w-0">
        {Array.from({ length: displayBlocks }).map((_, i) => (
          <div
            key={i}
            className={`h-2.5 sm:h-3 flex-1 rounded-sm ${
              i < filledBlocks ? "bg-green-600" : "bg-green-950"
            }`}
          />
        ))}
      </div>
      <span className="text-xs text-green-600 w-12 sm:w-16 text-right shrink-0">
        {freeList.count}
      </span>
    </div>
  );
}

// ── Main App ───────────────────────────────────────────
export default function App() {
  const [state, setState] = useState<AllocatorState>(createInitialState);
  const [logs, setLogs] = useState<LogEntry[]>([
    { message: "Allocator initialized. 8 size classes ready.", type: "info" }
  ]);
  const [selectedThread, setSelectedThread] = useState(0);
  const [selectedSize, setSelectedSize] = useState(32);
  const [running, setRunning] = useState(false);
  const [speed, setSpeed] = useState(2);
  const logRef = useRef<HTMLDivElement>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (logRef.current)
      logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [logs]);

  const alloc = useCallback(() => {
    const newLogs: LogEntry[] = [];
    setState(prev => simulateAlloc(prev, selectedThread, selectedSize, newLogs));
    setLogs(prev => [...prev.slice(-100), ...newLogs]);
  }, [selectedThread, selectedSize]);

  const dealloc = useCallback(() => {
    const newLogs: LogEntry[] = [];
    setState(prev => simulateDealloc(prev, selectedThread, selectedSize, newLogs));
    setLogs(prev => [...prev.slice(-100), ...newLogs]);
  }, [selectedThread, selectedSize]);

  useEffect(() => {
    if (running) {
      intervalRef.current = setInterval(() => {
        const tId = Math.floor(Math.random() * NUM_THREADS);
        const sz = SIZE_CLASSES[Math.floor(Math.random() * 4)];
        const action = Math.random() > 0.3 ? "alloc" : "dealloc";
        const newLogs: LogEntry[] = [];
        if (action === "alloc") {
          setState(prev => simulateAlloc(prev, tId, sz, newLogs));
        } else {
          setState(prev => simulateDealloc(prev, tId, sz, newLogs));
        }
        setLogs(prev => [...prev.slice(-100), ...newLogs]);
      }, 1000 / speed);
    } else {
      if (intervalRef.current) clearInterval(intervalRef.current);
    }
    return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
  }, [running, speed]);

  const reset = () => {
    setState(createInitialState());
    setLogs([{ message: "Allocator reset.", type: "info" }]);
    setRunning(false);
  };

  const { stats } = state;
  const hitRate = stats.totalAllocs > 0
    ? ((stats.cacheHits / stats.totalAllocs) * 100).toFixed(1)
    : "0.0";
  const missRate = stats.totalAllocs > 0
    ? ((stats.cacheMisses / stats.totalAllocs) * 100).toFixed(1)
    : "0.0";

  return (
    <div className="min-h-screen bg-[#050f05] text-white font-mono p-3 sm:p-4 md:p-6">

      {/* Header */}
      <div className="flex items-start sm:items-center justify-between mb-4 sm:mb-6 gap-2">
        <div>
          <h1 className="text-lg sm:text-xl md:text-2xl font-bold text-green-400 tracking-widest uppercase">
            Lock-Free Allocator
          </h1>
          <p className="text-xs text-green-800 mt-0.5 hidden sm:block">
            CAS-based slab allocator with thread-local cache (C++ Simulation)
          </p>
        </div>
        <a href="https://github.com/Preethi0602/Lockfree-Allocator-Cpp"
          target="_blank" rel="noreferrer"
          className="text-xs text-green-500 border border-green-800 px-2 sm:px-3 py-1 sm:py-1.5 rounded-lg hover:bg-green-900/30 transition shrink-0">
          GitHub
        </a>
      </div>

      {/* Controls */}
      <div className="bg-[#0a150a] border border-green-900 rounded-xl p-3 sm:p-4 mb-4">

        {/* Thread + Size selectors */}
        <div className="flex flex-wrap gap-3 mb-3">
          <div>
            <p className="text-xs text-green-600 mb-1.5 uppercase tracking-widest">Thread</p>
            <div className="flex gap-1.5">
              {Array.from({ length: NUM_THREADS }).map((_, i) => (
                <button key={i} onClick={() => setSelectedThread(i)}
                  className={`w-8 h-8 sm:w-9 sm:h-9 rounded-lg border text-xs font-bold transition ${
                    selectedThread === i
                      ? "bg-green-600 border-green-400 text-white"
                      : "border-green-800 text-green-600 hover:border-green-500"
                  }`}>
                  T{i}
                </button>
              ))}
            </div>
          </div>

          <div className="flex-1 min-w-0">
            <p className="text-xs text-green-600 mb-1.5 uppercase tracking-widest">Size</p>
            <div className="flex gap-1 flex-wrap">
              {SIZE_CLASSES.slice(0, 6).map(s => (
                <button key={s} onClick={() => setSelectedSize(s)}
                  className={`px-2 h-8 sm:h-9 rounded-lg border text-xs font-bold transition ${
                    selectedSize === s
                      ? "bg-green-600 border-green-400 text-white"
                      : "border-green-800 text-green-600 hover:border-green-500"
                  }`}>
                  {s}b
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Action buttons */}
        <div className="flex flex-wrap gap-2 items-center">
          <button onClick={alloc}
            className="flex-1 sm:flex-none px-4 h-9 bg-green-700 hover:bg-green-600 rounded-lg text-xs font-bold transition min-w-24">
            Allocate
          </button>
          <button onClick={dealloc}
            className="flex-1 sm:flex-none px-4 h-9 border border-green-700 hover:bg-green-900 rounded-lg text-xs font-bold transition min-w-24">
            Deallocate
          </button>

          <div className="w-px h-6 bg-green-900 hidden sm:block" />

          <button onClick={() => setRunning(r => !r)}
            className={`flex-1 sm:flex-none px-4 h-9 rounded-lg text-xs font-bold transition border min-w-24 ${
              running
                ? "bg-green-800 border-green-500 text-green-300"
                : "border-green-700 text-green-400 hover:bg-green-900"
            }`}>
            {running ? "Pause" : "Auto Run"}
          </button>

          <div className="flex items-center gap-2 flex-1 sm:flex-none">
            <span className="text-xs text-green-700 shrink-0">Speed:</span>
            <input type="range" min={1} max={10} value={speed}
              onChange={e => setSpeed(Number(e.target.value))}
              className="flex-1 sm:w-20 accent-green-500" />
            <span className="text-xs text-green-500 w-5 shrink-0">{speed}x</span>
          </div>

          <button onClick={reset}
            className="px-3 h-9 border border-green-900 hover:bg-green-950 rounded-lg text-xs font-bold transition text-green-700">
            Reset
          </button>
        </div>
      </div>

    
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-4">

        {/* Thread Caches */}
        <div className="bg-[#0a150a] border border-green-900 rounded-xl p-3 sm:p-4">
          <div className="flex items-center justify-between mb-3">
            <p className="text-xs text-green-600 uppercase tracking-widest">
              Thread-Local Caches
            </p>
            <span className="text-xs text-green-800 hidden sm:block">
              {THREAD_CACHE_MAX} max per thread
            </span>
          </div>
          <div className="space-y-2 sm:space-y-3">
            {state.threadCaches.map((cache, i) => (
              <ThreadCacheBar
                key={i}
                threadId={i}
                cache={cache}
                isActive={state.lastEvent?.threadId === i}
              />
            ))}
          </div>
          <div className="mt-3 p-2 sm:p-3 bg-green-950/30 rounded-lg border border-green-900/50">
            <p className="text-xs text-green-700 leading-relaxed">
              Green blocks = cached memory. Full cache means zero atomic ops on alloc.
              Empty cache triggers a CAS on the global free list.
            </p>
          </div>
        </div>

        {/* Free Lists + Stats */}
        <div className="space-y-4">

          {/* Global Free Lists */}
          <div className="bg-[#0a150a] border border-green-900 rounded-xl p-3 sm:p-4">
            <p className="text-xs text-green-600 uppercase tracking-widest mb-3">
              Global Free Lists (CAS protected)
            </p>
            <div className="space-y-0.5">
              {SIZE_CLASSES.map((s, i) => (
                <FreeListBar
                  key={s}
                  size={s}
                  freeList={state.freeLists[i]}
                />
              ))}
            </div>
          </div>

          {/* Stats Grid */}
          <div className="bg-[#0a150a] border border-green-900 rounded-xl p-3 sm:p-4">
            <p className="text-xs text-green-600 uppercase tracking-widest mb-3">
              Statistics
            </p>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
              {[
                { label: "Cache Hit Rate", value: `${hitRate}%`, color: "text-green-400", bar: Number(hitRate), barColor: "bg-green-500" },
                { label: "Cache Miss Rate", value: `${missRate}%`, color: "text-yellow-400", bar: Number(missRate), barColor: "bg-yellow-600" },
                { label: "Total Allocs", value: stats.totalAllocs, color: "text-green-300" },
                { label: "Total Deallocs", value: stats.totalDeallocs, color: "text-green-300" },
                { label: "CAS Retries", value: stats.casRetries, color: "text-orange-400" },
                { label: "Slabs Created", value: stats.slabsCreated, color: "text-cyan-400" },
              ].map((item, i) => (
                <div key={i} className="bg-green-950/30 rounded-lg p-2 sm:p-3 border border-green-900/50">
                  <p className="text-xs text-green-700 mb-1 leading-tight">{item.label}</p>
                  <p className={`text-lg sm:text-xl font-bold ${item.color}`}>{item.value}</p>
                  {item.bar !== undefined && (
                    <div className="mt-1 h-1 bg-green-950 rounded-full overflow-hidden">
                      <div className={`h-full ${item.barColor} rounded-full transition-all`}
                        style={{ width: `${item.bar}%` }} />
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Log */}
      <div className="bg-[#0a150a] border border-green-900 rounded-xl p-3 sm:p-4">
        <p className="text-xs text-green-600 uppercase tracking-widest mb-2">
          Allocation Log
        </p>
        <div ref={logRef} className="max-h-32 sm:max-h-40 overflow-y-auto space-y-0.5">
          {logs.map((log, i) => (
            <div key={i} className={`text-xs px-1 py-0.5 break-words ${
              log.type === "hit"     ? "text-green-400" :
              log.type === "miss"    ? "text-yellow-400" :
              log.type === "cas"     ? "text-orange-400" :
              log.type === "slab"    ? "text-cyan-400" :
              log.type === "dealloc" ? "text-blue-400" :
              "text-green-700"
            }`}>
              {">"} {log.message}
            </div>
          ))}
        </div>
        <div className="flex flex-wrap gap-2 sm:gap-4 mt-2 sm:mt-3 text-xs">
          <span className="text-green-400">■ Cache HIT</span>
          <span className="text-yellow-400">■ Cache MISS</span>
          <span className="text-orange-400">■ CAS retry</span>
          <span className="text-cyan-400">■ New slab</span>
          <span className="text-blue-400">■ Dealloc</span>
        </div>
      </div>

      <div className="mt-4 text-center text-xs text-green-900">
        Built with C++ (std::atomic, CAS, slab allocator) + React + TypeScript
      </div>
    </div>
  );
}