#pragma once

#include "free_list.h"
#include <cstddef>
#include <cstdint>

//Constants 
#define SLAB_SIZE (1024 * 256)  // 256KB per slab
#define MAX_SIZE_CLASSES 8             // number of size classes
#define THREAD_CACHE_MAX 16            // max blocks per thread cache

// Size classes: 8, 16, 32, 64, 128, 256, 512, 1024 bytes
static const size_t SIZE_CLASSES[MAX_SIZE_CLASSES] = {
    8, 16, 32, 64, 128, 256, 512, 1024
};

// Slab 
// A large chunk of memory pre-divided into equal-size blocks
struct Slab {
    size_t  blockSize;    // size of each block in this slab
    char*   memory;       // raw memory backing this slab
    size_t  totalBlocks;  // how many blocks fit in this slab
    Slab*   next;         // next slab in chain (if we need more)

    Slab(size_t blockSize);
    ~Slab();

    // Carve all blocks out and push onto a free list
    void initialize(FreeList& freeList);
};

//Thread-Local Cache 
// Each thread has one of these per size class
// Avoids hitting the global free list on every allocation
struct ThreadCache {
    Block*  blocks[THREAD_CACHE_MAX];  // cached free blocks
    int     count;                     // how many cached

    ThreadCache() : count(0) {}

    // Push a block into local cache
    // Returns false if cache is full
    bool push(Block* block);

    // Pop a block from local cache
    // Returns nullptr if empty
    Block* pop();

    bool empty() const { return count == 0; }
    bool full()  const { return count >= THREAD_CACHE_MAX; }
};