import type { TimelineDto } from "../types/domain";

const MAX_HISTORY = 100;

export class UndoManager {
  private history: TimelineDto[] = [];
  private pointer = -1;

  push(snapshot: TimelineDto): void {
    // Discard any redo states ahead of the pointer
    this.history = this.history.slice(0, this.pointer + 1);
    this.history.push(structuredClone(snapshot));
    if (this.history.length > MAX_HISTORY) {
      this.history.shift();
    }
    this.pointer = this.history.length - 1;
  }

  undo(): TimelineDto | null {
    if (this.pointer <= 0) return null;
    this.pointer--;
    return structuredClone(this.history[this.pointer]);
  }

  redo(): TimelineDto | null {
    if (this.pointer >= this.history.length - 1) return null;
    this.pointer++;
    return structuredClone(this.history[this.pointer]);
  }

  get canUndo(): boolean {
    return this.pointer > 0;
  }

  get canRedo(): boolean {
    return this.pointer < this.history.length - 1;
  }

  clear(): void {
    this.history = [];
    this.pointer = -1;
  }
}

export const undoManager = new UndoManager();
