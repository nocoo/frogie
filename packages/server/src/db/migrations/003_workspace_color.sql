-- Migration 003: Add color column to workspaces
-- Allows users to assign a color to each workspace for visual identification

ALTER TABLE workspaces ADD COLUMN color TEXT DEFAULT NULL;
