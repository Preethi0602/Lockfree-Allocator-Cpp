CXX = g++
CXXFLAGS = -std=c++17 -Wall -Wextra -g -O2
SRC_DIR = src
INC_DIR = include
TEST_DIR = tests
BUILD_DIR = build

SRCS = $(SRC_DIR)/free_list.cpp \
       $(SRC_DIR)/slab.cpp \
       $(SRC_DIR)/allocator.cpp

TEST_SRC = $(TEST_DIR)/main.cpp
TARGET = allocator_demo

all:
	mkdir -p $(BUILD_DIR)
	$(CXX) $(CXXFLAGS) -I$(INC_DIR) $(SRCS) $(TEST_SRC) -o $(BUILD_DIR)/$(TARGET)

run: all
	./$(BUILD_DIR)/$(TARGET)

clean:
	rm -rf $(BUILD_DIR)
