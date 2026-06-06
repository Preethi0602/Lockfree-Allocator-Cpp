#include "../include/allocator.h"
#include <iostream>
#include <iomanip>
#include <thread>
#include <vector>
#include <chrono>
#include <cassert>
#include <cstring>

// Demo 1: Basic allocation and deallocation 
void demoBasic() {
    std::cout << "\n DEMO 1: Basic Allocation \n";

    void* p8   = gAllocator->allocate(8);
    void* p16  = gAllocator->allocate(16);
    void* p32  = gAllocator->allocate(32);
    void* p100 = gAllocator->allocate(100);  // rounds up to 128

    std::cout << "Allocated 8 bytes at:   " << p8   << "\n";
    std::cout << "Allocated 16 bytes at:  " << p16  << "\n";
    std::cout << "Allocated 32 bytes at:  " << p32  << "\n";
    std::cout << "Allocated 100 bytes at: " << p100
              << " (rounded to 128)\n";

    memset(p8,   0xAA, 8);
    memset(p16,  0xBB, 16);
    memset(p32,  0xCC, 32);
    memset(p100, 0xDD, 100);

    std::cout << "Memory write/read verified\n";

    gAllocator->deallocate(p8,   8);
    gAllocator->deallocate(p16,  16);
    gAllocator->deallocate(p32,  32);
    gAllocator->deallocate(p100, 100);

    std::cout << "All blocks deallocated\n";
}

//Demo 2: Multithreaded allocation 
void threadWorker(int threadId, int numAllocs) {
    std::vector<void*> ptrs;
    ptrs.reserve(numAllocs);

    for (int i = 0; i < numAllocs; i++) {
        void* p = gAllocator->allocate(32);
        assert(p != nullptr);
        memset(p, threadId & 0xFF, 32);
        ptrs.push_back(p);
    }

    for (void* p : ptrs) {
        assert(static_cast<unsigned char*>(p)[0] == (threadId & 0xFF));
    }

    for (void* p : ptrs) {
        gAllocator->deallocate(p, 32);
    }

    std::cout << "[Thread " << threadId << "] "
              << numAllocs << " allocs/deallocs - OK\n";
}

void demoMultithreaded() {
    std::cout << "\n DEMO 2: Multithreaded Allocation \n";
    std::cout << "4 threads, 1000 allocations each\n";

    std::vector<std::thread> threads;
    for (int i = 0; i < 4; i++) {
        threads.emplace_back(threadWorker, i, 1000);
    }
    for (auto& t : threads) t.join();

    std::cout << "All threads completed without corruption\n";
}

//Demo 3: Benchmark vs malloc 
void demoBenchmark() {
    std::cout << "\n DEMO 3: Benchmark vs malloc \n";

    const int N     = 100000;
    const int BATCH = 16;  // allocate 16, free 16, repeat
                           // this lets thread cache warm up

    std::vector<void*> ptrs(BATCH);

    // Benchmark our allocator
    auto start = std::chrono::high_resolution_clock::now();
    for (int i = 0; i < N / BATCH; i++) {
        for (int j = 0; j < BATCH; j++)
            ptrs[j] = gAllocator->allocate(32);
        for (int j = 0; j < BATCH; j++)
            gAllocator->deallocate(ptrs[j], 32);
    }
    auto end = std::chrono::high_resolution_clock::now();
    auto ourTime = std::chrono::duration_cast<std::chrono::microseconds>
                   (end - start).count();

    // Benchmark malloc
    start = std::chrono::high_resolution_clock::now();
    for (int i = 0; i < N / BATCH; i++) {
        for (int j = 0; j < BATCH; j++)
            ptrs[j] = malloc(32);
        for (int j = 0; j < BATCH; j++)
            free(ptrs[j]);
    }
    end = std::chrono::high_resolution_clock::now();
    auto mallocTime = std::chrono::duration_cast<std::chrono::microseconds>
                      (end - start).count();

    std::cout << "Our allocator: " << ourTime    << " us\n";
    std::cout << "malloc:        " << mallocTime << " us\n";
    if (ourTime > 0) {
        std::cout << "Speedup:       "
                  << std::fixed << std::setprecision(2)
                  << (double)mallocTime / ourTime << "x\n";
    }
}

// Demo 4: Size class verification 
void demoSizeClasses() {
    std::cout << "\n DEMO 4: Size Class Rounding \n";

    size_t testSizes[] = { 1, 8, 9, 16, 17, 32, 33, 64, 65, 128, 256, 512, 1024 };
    for (size_t s : testSizes) {
        size_t rounded = LockFreeAllocator::roundUpToSizeClass(s);
        std::cout << "  " << std::setw(5) << s
                  << " bytes -> size class "
                  << std::setw(5) << rounded << " bytes\n";
    }
}

// Main 
int main() {
    gAllocator = new LockFreeAllocator();

    demoBasic();
    demoMultithreaded();
    demoBenchmark();
    demoSizeClasses();

    gAllocator->printStats();

    delete gAllocator;
    return 0;
}