/**
 * @jest-environment jsdom
 */
import { render, screen, fireEvent } from '@testing-library/react';

import { HorizontalScrollable } from '../horizontal-scrollable';

describe('HorizontalScrollable', () => {
  describe('rendering', () => {
    it('renders children correctly', () => {
      render(
        <HorizontalScrollable>
          <div data-testid="child">Child content</div>
        </HorizontalScrollable>,
      );

      expect(screen.getByTestId('child')).toBeInTheDocument();
      expect(screen.getByText('Child content')).toBeInTheDocument();
    });

    it('renders with no children', () => {
      render(<HorizontalScrollable data-testid="scrollable" />);
      expect(screen.getByTestId('scrollable')).toBeInTheDocument();
    });

    it('renders with multiple children', () => {
      render(
        <HorizontalScrollable data-testid="scrollable">
          <div data-testid="child-1">First</div>
          <div data-testid="child-2">Second</div>
          <div data-testid="child-3">Third</div>
        </HorizontalScrollable>,
      );

      expect(screen.getByTestId('child-1')).toBeInTheDocument();
      expect(screen.getByTestId('child-2')).toBeInTheDocument();
      expect(screen.getByTestId('child-3')).toBeInTheDocument();
    });

    it('passes through HTML div attributes', () => {
      render(
        <HorizontalScrollable
          className="custom-class"
          data-testid="scrollable"
          id="my-scrollable"
        >
          Content
        </HorizontalScrollable>,
      );

      const div = screen.getByTestId('scrollable');
      expect(div).toHaveClass('custom-class');
      expect(div).toHaveAttribute('id', 'my-scrollable');
      expect(div.dataset.testid).toBe('scrollable');
    });

    it('renders as a div element', () => {
      render(
        <HorizontalScrollable data-testid="scrollable">
          Content
        </HorizontalScrollable>,
      );

      const element = screen.getByTestId('scrollable');
      expect(element.tagName).toBe('DIV');
    });
  });

  describe('wheel event handling', () => {
    function mockOverflowing(element: HTMLElement) {
      Object.defineProperty(element, 'scrollWidth', { value: 2000 });
      Object.defineProperty(element, 'clientWidth', { value: 500 });
    }

    it('converts vertical scroll to horizontal scroll', () => {
      render(
        <HorizontalScrollable data-testid="scrollable">
          <div style={{ width: '2000px' }}>Wide content</div>
        </HorizontalScrollable>,
      );

      const scrollable = screen.getByTestId('scrollable');
      mockOverflowing(scrollable);
      Object.defineProperty(scrollable, 'scrollLeft', {
        value: 0,
        writable: true,
      });

      fireEvent.wheel(scrollable, { deltaY: 100, deltaX: 0 });

      expect(scrollable.scrollLeft).toBe(100);
    });

    it('allows native horizontal scroll to pass through', () => {
      render(
        <HorizontalScrollable data-testid="scrollable">
          <div style={{ width: '2000px' }}>Wide content</div>
        </HorizontalScrollable>,
      );

      const scrollable = screen.getByTestId('scrollable');
      mockOverflowing(scrollable);
      const wheelEvent = new WheelEvent('wheel', {
        deltaY: 10,
        deltaX: 100,
        bubbles: true,
        cancelable: true,
      });

      const prevented = !scrollable.dispatchEvent(wheelEvent);

      // When scrolling horizontally, preventDefault should not be called.
      expect(prevented).toBe(false);
    });

    it('prevents default on vertical scroll when not disabled', () => {
      render(
        <HorizontalScrollable data-testid="scrollable">
          <div style={{ width: '2000px' }}>Wide content</div>
        </HorizontalScrollable>,
      );

      const scrollable = screen.getByTestId('scrollable');
      mockOverflowing(scrollable);
      const wheelEvent = new WheelEvent('wheel', {
        deltaY: 100,
        deltaX: 0,
        bubbles: true,
        cancelable: true,
      });

      const prevented = !scrollable.dispatchEvent(wheelEvent);

      expect(prevented).toBe(true);
    });

    it('does not prevent default when disabled', () => {
      render(
        <HorizontalScrollable data-testid="scrollable" disable>
          <div style={{ width: '2000px' }}>Wide content</div>
        </HorizontalScrollable>,
      );

      const scrollable = screen.getByTestId('scrollable');
      mockOverflowing(scrollable);
      const wheelEvent = new WheelEvent('wheel', {
        deltaY: 100,
        deltaX: 0,
        bubbles: true,
        cancelable: true,
      });

      const prevented = !scrollable.dispatchEvent(wheelEvent);

      expect(prevented).toBe(false);
    });

    it('does not hijack scroll when content fits', () => {
      render(
        <HorizontalScrollable data-testid="scrollable">
          <div>Short content</div>
        </HorizontalScrollable>,
      );

      const scrollable = screen.getByTestId('scrollable');
      Object.defineProperty(scrollable, 'scrollWidth', { value: 500 });
      Object.defineProperty(scrollable, 'clientWidth', { value: 500 });
      const wheelEvent = new WheelEvent('wheel', {
        deltaY: 100,
        deltaX: 0,
        bubbles: true,
        cancelable: true,
      });

      const prevented = !scrollable.dispatchEvent(wheelEvent);

      expect(prevented).toBe(false);
    });

    it('handles negative deltaY for scrolling up', () => {
      render(
        <HorizontalScrollable data-testid="scrollable">
          <div style={{ width: '2000px' }}>Wide content</div>
        </HorizontalScrollable>,
      );

      const scrollable = screen.getByTestId('scrollable');
      mockOverflowing(scrollable);
      Object.defineProperty(scrollable, 'scrollLeft', {
        value: 200,
        writable: true,
      });

      fireEvent.wheel(scrollable, { deltaY: -50, deltaX: 0 });

      expect(scrollable.scrollLeft).toBe(150);
    });

    it('handles zero delta values', () => {
      render(
        <HorizontalScrollable data-testid="scrollable">
          <div style={{ width: '2000px' }}>Wide content</div>
        </HorizontalScrollable>,
      );

      const scrollable = screen.getByTestId('scrollable');
      mockOverflowing(scrollable);
      Object.defineProperty(scrollable, 'scrollLeft', {
        value: 50,
        writable: true,
      });

      fireEvent.wheel(scrollable, { deltaY: 0, deltaX: 0 });

      // Neither deltaY nor deltaX dominates, so should pass through.
      expect(scrollable.scrollLeft).toBe(50);
    });

    it('handles equal deltaX and deltaY', () => {
      render(
        <HorizontalScrollable data-testid="scrollable">
          <div style={{ width: '2000px' }}>Wide content</div>
        </HorizontalScrollable>,
      );

      const scrollable = screen.getByTestId('scrollable');
      mockOverflowing(scrollable);
      const wheelEvent = new WheelEvent('wheel', {
        deltaY: 50,
        deltaX: 50,
        bubbles: true,
        cancelable: true,
      });

      const prevented = !scrollable.dispatchEvent(wheelEvent);

      // Should let the native scroll handle it.
      expect(prevented).toBe(false);
    });

    it('cleans up event listener on unmount', () => {
      const removeEventListenerSpy = jest.spyOn(
        HTMLDivElement.prototype,
        'removeEventListener',
      );

      const { unmount } = render(
        <HorizontalScrollable data-testid="scrollable">
          Content
        </HorizontalScrollable>,
      );

      unmount();

      expect(removeEventListenerSpy).toHaveBeenCalledWith(
        'wheel',
        expect.any(Function),
      );

      removeEventListenerSpy.mockRestore();
    });
  });

  describe('props', () => {
    it('does not convert scroll when disable is true', () => {
      render(
        <HorizontalScrollable data-testid="scrollable" disable>
          <div style={{ width: '2000px' }}>Wide content</div>
        </HorizontalScrollable>,
      );

      const scrollable = screen.getByTestId('scrollable');
      Object.defineProperty(scrollable, 'scrollWidth', { value: 2000 });
      Object.defineProperty(scrollable, 'clientWidth', { value: 500 });
      const initialScrollLeft = scrollable.scrollLeft;

      fireEvent.wheel(scrollable, { deltaY: 100, deltaX: 0 });

      expect(scrollable.scrollLeft).toBe(initialScrollLeft);
    });

    it('re-enables scroll conversion when disable changes to false', () => {
      const { rerender } = render(
        <HorizontalScrollable data-testid="scrollable" disable>
          <div style={{ width: '2000px' }}>Wide content</div>
        </HorizontalScrollable>,
      );

      const scrollable = screen.getByTestId('scrollable');
      Object.defineProperty(scrollable, 'scrollWidth', { value: 2000 });
      Object.defineProperty(scrollable, 'clientWidth', { value: 500 });
      Object.defineProperty(scrollable, 'scrollLeft', {
        value: 0,
        writable: true,
      });

      fireEvent.wheel(scrollable, { deltaY: 100, deltaX: 0 });
      expect(scrollable.scrollLeft).toBe(0);

      rerender(
        <HorizontalScrollable data-testid="scrollable" disable={false}>
          <div style={{ width: '2000px' }}>Wide content</div>
        </HorizontalScrollable>,
      );

      fireEvent.wheel(scrollable, { deltaY: 100, deltaX: 0 });
      expect(scrollable.scrollLeft).toBe(100);
    });

    it('assigns element to customRef', () => {
      const customRef = { current: null as HTMLDivElement | null };

      render(
        <HorizontalScrollable customRef={customRef} data-testid="scrollable">
          Content
        </HorizontalScrollable>,
      );

      const scrollable = screen.getByTestId('scrollable');
      expect(customRef.current).toBe(scrollable);
    });
  });
});
