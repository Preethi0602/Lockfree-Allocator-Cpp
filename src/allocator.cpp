#include "../include/allocator.h"
#include <iostream>
#include <iomanip>
#include <cassert>
#include <cstring>

//Global allocator instance
LockFreeAllocator* gAllocator = nullptr;

// Thread-local cache definition 
thread_local ThreadCache LockFreeAllocator::threadCaches[MAX_SIZE_CLASSES];

//Constructor 
LockFreeAllocator::LockFreeAllocator()
    : totalAllocations(0),
      totalDeallocations(0),
      totalSlabsCreated(0),
      cacheMisses(0) {
    // Initialize slab pointers to null
    for (int i = 0; i < MAX_SIZE_CLASSES; i++) {
        slabs[i] = nullptr;
    }
    std::cout << "[Allocator] Initialized with "
              << MAX_SIZE_CLASSES << " size classes\n";
}

// Destructor 
LockFreeAllocator::~LockFreeAllocator() {
    for (int i = 0; i < MAX_SIZE_CLASSES; i++) {
        Slab* slab = slabs[i];
        while (slab) {
            Slab* next = slab->next;
            delete slab;
            slab = next;
        }
    }
}

// Get size class index 
int LockFreeAllocator::getSizeClassIndex(size_t size) {
    for (int i = 0; i < MAX_SIZE_CLASSES; i++) {
        if (size <= SIZE_CLASSES[i]) return i;
    }
    return -1; // too large for slab allocator
}

//Round up to nearest size class 
size_t LockFreeAllocator::roundUpToSizeClass(size_t size) {
    int idx = getSizeClassIndex(size);
    if (idx == -1) return size;
    return SIZE_CLASSES[idx];
}

//Allocate new slab 
void LockFreeAllocator::allocateNewSlab(int idx) {
    Slab* slab = new Slab(SIZE_CLASSES[idx]);
    slab->initialize(globalFreeLists[idx]);

    // Add to slab chain
    slab->next = slabs[idx];
    slabs[idx] = slab;

    totalSlabsCreated.fetch_add(1, std::memory_order_relaxed);
}

//Allocate 
void* LockFreeAllocator::allocate(size_t size) {
    if (size == 0) return nullptr;

    int idx = getSizeClassIndex(size);

    // Large allocation fall back to malloc
    if (idx == -1) {
        return malloc(size);
    }

    totalAllocations.fetch_add(1, std::memory_order_relaxed);

    // 1. Check thread-local cache first (no atomic needed)
    Block* block = threadCaches[idx].pop();
    if (block) {
        return static_cast<void*>(block);
    }

    // 2. Cache miss go to global free list (CAS)
    cacheMisses.fetch_add(1, std::memory_order_relaxed);
    block = globalFreeLists[idx].pop();

    // 3. Free list empty allocate new slab
    if (!block) {
        allocateNewSlab(idx);
        block = globalFreeLists[idx].pop();
    }

    return static_cast<void*>(block);
}

// Deallocate 
void LockFreeAllocator::deallocate(void* ptr, size_t size) {
    if (!ptr) return;

    int idx = getSizeClassIndex(size);

    // Large allocation fall back to free
    if (idx == -1) {
        free(ptr);
        return;
    }

    totalDeallocations.fetch_add(1, std::memory_order_relaxed);

    Block* block = static_cast<Block*>(ptr);
    block->next = nullptr;

    // 1. Try thread-local cache first
    if (threadCaches[idx].push(block)) {
        return;
    }

    // 2. Cache full push to global free list (CAS)
    globalFreeLists[idx].push(block);
}

//Print Stats
void LockFreeAllocator::printStats() const {
    std::cout << "\n[Allocator Stats]\n";
    std::cout << "  Total Allocations:   "
              << totalAllocations.load() << "\n";
    std::cout << "  Total Deallocations: "
              << totalDeallocations.load() << "\n";
    std::cout << "  Slabs Created:       "
              << totalSlabsCreated.load() << "\n";
    std::cout << "  Cache Misses:        "
              << cacheMisses.load() << "\n";

    double missRate = totalAllocations.load() > 0
        ? (100.0 * cacheMisses.load() / totalAllocations.load())
        : 0.0;
    std::cout << "  Cache Miss Rate:     "
              << std::fixed << std::setprecision(1)
              << missRate << "%\n";

    std::cout << "\n[Free List Sizes]\n";
    for (int i = 0; i < MAX_SIZE_CLASSES; i++) {
        std::cout << "  " << std::setw(5) << SIZE_CLASSES[i]
                  << " bytes: " << globalFreeLists[i].size()
                  << " free blocks\n";
    }
}