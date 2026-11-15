import { afterEach, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import App from './App';

afterEach(cleanup);
it('exposes a named, focusable settings scroll region for keyboard navigation', () => {
  render(<App />);
  fireEvent.click(screen.getByRole('button', { name: /^Settings$/ }));
  const pane = screen.getByRole('region', { name: 'Settings content' });
  expect(pane.tabIndex).toBe(0);
  expect(pane.className).toBe('content-scroll');
});
