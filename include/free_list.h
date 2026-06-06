#pragma once

#include <atomic>
#include <cstddef>

//A single free block in the list
struct Block {
    Block* next;    // pointer to next free block
    // actual memory follows immediately after this header
};

//Lock-Free Free List 
// A stack (LIFO) of free memory blocks
// Uses CAS for thread-safe push/pop without any mutex
class FreeList {
public:
    FreeList();

    // Push a block back onto the free list (deallocate)
    void push(Block* block);

    // Pop a block off the free list (allocate)
    // Returns nullptr if list is empty
    Block* pop();

    // Check if empty
    bool empty() const;

    // How many blocks are currently free
    int size() const;

private:
    std::atomic<Block*> head;   // atomic pointer to top of stack
    std::atomic<int> count;     // number of free blocks
};