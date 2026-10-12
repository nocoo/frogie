import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@nocoo/basalt/components/select";

interface SelectionFieldProps {
  id?: string;
  "aria-label"?: string;
  "aria-describedby"?: string;
  items: readonly { value: string; label: string }[];
  value: string;
  disabled?: boolean;
  placeholder?: string;
  onValueChange(value: string): void;
}

export function SelectionField({
  items,
  value,
  disabled = false,
  placeholder = "请选择",
  onValueChange,
  ...triggerProps
}: SelectionFieldProps) {
  return (
    <Select value={value} disabled={disabled} onValueChange={onValueChange}>
      <SelectTrigger {...triggerProps} className="frogie-select">
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent>
        {items.map((item) => (
          <SelectItem key={item.value} value={item.value}>
            {item.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
