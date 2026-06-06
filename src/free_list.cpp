#include "../include/free_list.h"

FreeList::FreeList()
    : head(nullptr), count(0) {}

// Push (deallocate back to list) 
void FreeList::push(Block* block) {
    Block* oldHead;
    do {
        oldHead = head.load(std::memory_order_relaxed);
        block->next = oldHead;
    } while (!head.compare_exchange_weak(
        oldHead,
        block,
        std::memory_order_release,
        std::memory_order_relaxed
    ));
    count.fetch_add(1, std::memory_order_relaxed);
}

//Pop (allocate from list) 
Block* FreeList::pop() {
    Block* oldHead;
    Block* newHead;
    do {
        oldHead = head.load(std::memory_order_acquire);
        if (oldHead == nullptr) return nullptr;
        newHead = oldHead->next;
    } while (!head.compare_exchange_weak(
        oldHead,
        newHead,
        std::memory_order_release,
        std::memory_order_relaxed
    ));
    count.fetch_sub(1, std::memory_order_relaxed);
    return oldHead;
}

//Empty check 
bool FreeList::empty() const {
    return head.load(std::memory_order_relaxed) == nullptr;
}

//Size
int FreeList::size() const {
    return count.load(std::memory_order_relaxed);
}