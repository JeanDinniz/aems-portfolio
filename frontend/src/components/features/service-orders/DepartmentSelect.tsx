import {
    FormControl,
    FormField,
    FormItem,
    FormLabel,
    FormMessage,
} from '@/components/ui/form';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select';
import { DEPARTMENTS } from '@/constants/service-orders';
import type { UseFormReturn, FieldValues, Path } from 'react-hook-form';

interface DepartmentSelectProps<T extends FieldValues = FieldValues> {
    form: UseFormReturn<T>;
    onDepartmentChange: (value: string) => void;
}

export function DepartmentSelect<T extends FieldValues = FieldValues>({ form, onDepartmentChange }: DepartmentSelectProps<T>) {
    return (
        <FormField
            control={form.control}
            name={'department' as Path<T>}
            render={({ field }) => (
                <FormItem>
                    <FormLabel>Departamento <span className="text-aems-error">*</span></FormLabel>
                    <Select
                        onValueChange={(value) => {
                            field.onChange(value);
                            onDepartmentChange(value);
                            form.setValue('selected_services' as Path<T>, [] as never);
                        }}
                        defaultValue={field.value}
                    >
                        <FormControl>
                            <SelectTrigger>
                                <SelectValue placeholder="Selecione o departamento" />
                            </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                            {DEPARTMENTS.map((dept) => (
                                <SelectItem key={dept.value} value={dept.value}>
                                    {dept.label}
                                </SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                    <FormMessage />
                </FormItem>
            )}
        />
    );
}
