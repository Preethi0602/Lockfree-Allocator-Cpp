#pragma once

#include "slab.h"
#include "free_list.h"
#include <cstddef>
#include <array>
#include <atomic>

// Lock-Free Slab Allocator 
//
// Architecture:
//   allocate(size)
//     1. Round up to nearest size class
//     2. Check thread-local cache (no atomic needed)
//     3. If empty, pop from global FreeList (CAS)
//     4. If FreeList empty, allocate new Slab
//
//   deallocate(ptr, size)
//     1. Round up to nearest size class
//     2. Push to thread-local cache if not full
//     3. If cache full, push to global FreeList (CAS)

class LockFreeAllocator {
public:
    LockFreeAllocator();
    ~LockFreeAllocator();

    // Allocate memory of given size
    void* allocate(size_t size);

    // Deallocate memory (must pass original size)
    void deallocate(void* ptr, size_t size);

    // Print allocator stats
    void printStats() const;

    // Get size class index for a given size
    static int getSizeClassIndex(size_t size);

    // Round size up to nearest size class
    static size_t roundUpToSizeClass(size_t size);

private:
    // One global free list per size class
    FreeList globalFreeLists[MAX_SIZE_CLASSES];

    // One slab chain per size class
    Slab* slabs[MAX_SIZE_CLASSES];

    // Stats
    std::atomic<size_t> totalAllocations;
    std::atomic<size_t> totalDeallocations;
    std::atomic<size_t> totalSlabsCreated;
    std::atomic<size_t> cacheMisses;   // times we had to go to global list

    // Thread local cache one per size class per thread
    static thread_local ThreadCache threadCaches[MAX_SIZE_CLASSES];

    // Allocate a new slab for the given size class
    void allocateNewSlab(int sizeClassIdx);
};

// Global allocator instance
extern LockFreeAllocator* gAllocator;