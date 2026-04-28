<script lang="ts">
import { defineComponent, h, cloneVNode, TransitionGroup } from 'vue';

export default defineComponent({
  name: 'ListTransition',
  props: {
    tag: {
      type: String,
      default: 'div',
    },
    staggerDelay: {
      type: Number,
      default: 30,
    },
  },
  setup(props, { slots }) {
    return () => {
      const children = slots.default?.() || [];
      const mapped = children.map((child, index) => {
        if (!child || typeof child === 'string' || typeof child === 'number') {
          return child;
        }
        const existingStyle = (child.props?.style || {}) as Record<string, string>;
        return cloneVNode(child, {
          style: {
            ...existingStyle,
            '--stagger-index': String(index),
            '--stagger-delay': `${props.staggerDelay}ms`,
          },
        });
      });

      return h(
        TransitionGroup,
        {
          tag: props.tag,
          enterActiveClass: 'list-transition-enter-active',
          enterFromClass: 'list-transition-enter-from',
          leaveActiveClass: 'list-transition-leave-active',
          leaveToClass: 'list-transition-leave-to',
          moveClass: 'list-transition-move',
        },
        () => mapped
      );
    };
  },
});
</script>

<style>
.list-transition-enter-active {
  transition: all 0.3s ease;
  transition-delay: calc(var(--stagger-index, 0) * var(--stagger-delay, 30ms));
}

.list-transition-enter-from {
  opacity: 0;
  transform: translateY(12px);
}

.list-transition-leave-active {
  transition: all 0.2s ease;
  position: absolute;
}

.list-transition-leave-to {
  opacity: 0;
  transform: translateY(-8px);
}

.list-transition-move {
  transition: transform 0.3s ease;
}

@media (prefers-reduced-motion: reduce) {
  .list-transition-enter-active,
  .list-transition-leave-active,
  .list-transition-move {
    transition: none;
  }
}
</style>
