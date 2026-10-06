"use client";

import "./form-select.css";

import { Select, type SelectProps } from "@bigcommerce/big-design";

// BigDesign's Select floats its list in an unsized Box, and every option has a
// 256px min-width, so the open list is ~256px wide regardless of the input
// (see Select.js / List/Item/styled.js in @bigcommerce/big-design). The wrapper
// is made the list's offset parent so its width: 100% resolves to the input
// width, and the option min-width is cancelled. The width rule is gated on
// :has([role="option"]) because the list container is always rendered, with
// an empty padded/shadowed <ul> while closed — sizing it unconditionally shows
// an empty box under every closed Select.
//
export function FormSelect<T>(props: SelectProps<T>) {
  return (
    <div className="huntry-select">
      <Select {...props} />
    </div>
  );
}
