export class GrabSelectionState {
  private current = -1;
  private beforeGrab: number | null = null;
  private preview = -1;

  select(index: number) {
    this.current = index;
  }

  beginGrab(index: number) {
    this.beforeGrab = this.current;
    this.current = -1;
    this.preview = index;
  }

  endGrab(index: number, cancelled: boolean) {
    this.current = cancelled ? (this.beforeGrab ?? -1) : index;
    this.beforeGrab = null;
    this.preview = -1;
  }

  get selected(): number { return this.current; }
  get previewed(): number { return this.preview; }
}
