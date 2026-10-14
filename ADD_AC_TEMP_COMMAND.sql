ALTER TABLE public.ac_state
ADD COLUMN IF NOT EXISTS ac_temp_command integer;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.ac_state'::regclass
      AND conname = 'ac_state_ac_temp_command_range'
  ) THEN
    ALTER TABLE public.ac_state
      ADD CONSTRAINT ac_state_ac_temp_command_range
      CHECK (
        ac_temp_command IS NULL OR
        ac_temp_command BETWEEN 16 AND 30
      );
  END IF;
END $$;