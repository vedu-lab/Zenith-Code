import { describe, it, expect } from 'vitest';
import { Header, StatusBadge, App } from '../src/index.js';

describe('TUI Package', () => {
  it('should export Header, StatusBadge, and App components', () => {
    expect(Header).toBeDefined();
    expect(StatusBadge).toBeDefined();
    expect(App).toBeDefined();
  });
});
