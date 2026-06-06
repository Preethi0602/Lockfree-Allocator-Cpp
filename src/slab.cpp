#include "../include/slab.h"
#include <iostream>
#include <cstdlib>

// Slab Constructor 
Slab::Slab(size_t blockSize)
    : blockSize(blockSize),
      memory(nullptr),
      totalBlocks(0),
      next(nullptr) {
    // Allocate raw memory for this slab
    memory = static_cast<char*>(malloc(SLAB_SIZE));
    if (!memory) {
        std::cerr << "[Slab] Failed to allocate memory!\n";
        return;
    }
    totalBlocks = SLAB_SIZE / blockSize;
}

// Slab Destructor 
Slab::~Slab() {
    if (memory) {
        free(memory);
        memory = nullptr;
    }
}

// Initialize (carve slab into blocks)
void Slab::initialize(FreeList& freeList) {
    if (!memory) return;

    // Walk through raw memory and create Block headers
    for (size_t i = 0; i < totalBlocks; i++) {
        char* raw = memory + (i * blockSize);
        Block* block = reinterpret_cast<Block*>(raw);
        block->next = nullptr;
        freeList.push(block);
    }

    std::cout << "[Slab] Initialized " << totalBlocks
              << " blocks of " << blockSize
              << " bytes each\n";
}

// Thread Cache: Push 
bool ThreadCache::push(Block* block) {
    if (full()) return false;
    blocks[count++] = block;
    return true;
}

//Thread Cache: Pop
Block* ThreadCache::pop() {
    if (empty()) return nullptr;
    return blocks[--count];
}