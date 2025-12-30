# Frontend Testing Improvements - Implementation Report

## Summary

This document outlines the testing improvements needed for the frontend to provide confidence that changes won't break existing functionality and that refactoring is safe.

## What Was Implemented

### 1. Test Infrastructure Improvements

**vitest.setup.ts** - Added AudioContext mock:
- Resolved "AudioContext is not defined" errors in tests
- Mocks createBuffer, createBufferSource, and decodeAudioData
- Provides realistic test data (duration: 180s, 2 channels, 44.1kHz sample rate)

**FileUpload.spec.ts** - Completed and fixed:
- ✅ Fixed component prop names (propsData → props, value → modelValue)
- ✅ Proper Buefy component stubbing strategy
- ✅ Tests file display, emission events, and clear functionality
- ✅ Validates delete button visibility logic

## What Still Needs Implementation

### Phase 1: Critical Path Coverage (Highest Priority)

#### 1. Shared Test Utilities (`frontend/test-utils/index.ts`)
Create reusable test helpers:
```typescript
- TEST_LYRICS: Tom Lehrer's "Masochism Tango" for realistic test data
- TEST_TIMINGS: Sample timing data matching lyric segments
- createTestPinia(): Fresh Pinia instance for test isolation
- createMockAudioFile(), createMockVideoFile(), createMockJsonFile()
- mountWithPinia(), shallowMountWithPinia(): Pre-configured mount helpers
- buefyStubs: Common Buefy component stubs
```

#### 2. LyricEditor.spec.ts (HIGH PRIORITY - 2-3 hours)
**Critical because**: Unique "magic slashes" feature with complex cursor management

Tests needed:
- ✅ Basic rendering and v-model binding
- ✅ Magic slashes: Auto-applies "/" to all word occurrences
- ✅ Case sensitivity handling (Hello → Hel/lo affects hello → hel/lo)
- ✅ Cursor position preservation after auto-updates
- ✅ Word boundary detection (underscores, newlines, punctuation)
- ✅ Space to underscore conversion method
- ✅ Edge cases: empty input, unicode, very long text

#### 3. SongTimingTab.spec.ts (HIGH PRIORITY - 3-4 hours)
**Critical because**: Core karaoke timing workflow

Tests needed:
- Tab enabled/disabled state based on song file + lyrics
- Audio playback controls (play/pause toggle, playback rate)
- **Keyboard event handling** (spacebar for segment start, enter for segment end)
- Timing recording with current audio time
- Current segment advancement
- Redo screen functionality
- Warning/success messages based on completion state
- Button keyboard toggle for mobile
- Integration with LyricDisplay and TimingButtons components

### Phase 2: User Workflow Components (Medium Priority)

#### 4. SongInfoTab.spec.ts (2-3 hours)
Tests needed:
- File upload integration
- YouTube URL loading (success/error states)
- Artist and title field binding
- Backing vocals toggle (model switching)
- **Advanced section**: Timings file upload, backing track upload
- Track separation button states and triggering
- Tab icon changes during processing

#### 5. TimingAdjustmentTab.spec.ts (2 hours)
Tests needed:
- Tab enabled only when timings exist
- SubtitleDisplay component integration
- TimingAdjuster component integration
- Playhead synchronization between components
- Timing change handling and store updates
- Vocal track passing when available
- Settings reactivity (background color changes)

#### 6. SubmitTab.spec.ts (2-3 hours)
Tests needed:
- Tab enabled when: song file + lyrics + finished timings
- Video options bindings (count-ins, instrumental breaks, staggered lines)
- Font and color settings
- Vertical alignment options
- VideoPreview component integration
- **Create Video workflow**:
  - Track separation if needed
  - Creation phase transitions
  - Progress indicator
  - Error handling
- File naming logic (with/without artist+title)
- Audio delay calculation
- FPS selection based on background video

## Testing Strategy

### Test What Users Do, Not Implementation

**Good**:
```typescript
test('records segment timing when spacebar pressed', async () => {
  await wrapper.trigger('keydown.space');
  expect(timingsStore.length).toBe(1);
});
```

**Bad** (tests implementation details):
```typescript
test('calls timingsStore.add when spacebar pressed', () => {
  expect(mockAdd).toHaveBeenCalled(); // Too coupled to implementation
});
```

### Test Component Contracts
Test the component's API (props, events, slots), not its internals.

### Use Realistic Test Data
Use Tom Lehrer's "Masochism Tango" lyrics for tests - provides:
- Real-world line lengths and patterns
- Natural segment boundaries
- Edge cases (punctuation, capitalization)

## Key Insights

### Current Gaps

1. **Component tests are too shallow**: Most only verify elements exist, not behavior
2. **Tab components are untested**: Core workflow has no unit test coverage
3. **User interaction testing is missing**: Keyboard events, form submissions, file uploads
4. **Integration between components is untested**: Store updates, prop passing, event chains

### What This Enables

With comprehensive tests, you can:
- ✅ Refactor `LyricEditor` magic slashes without fear of breaking subtle edge cases
- ✅ Change timing storage format knowing tests will catch incompatibilities
- ✅ Upgrade Vue/Vite/dependencies confidently
- ✅ Add new features knowing you didn't break existing workflows
- ✅ Get fast feedback (seconds) vs waiting for E2E tests (minutes)
- ✅ Pinpoint exactly what broke ("magic slashes fails on unicode") vs "timing tab doesn't work"

## Test Execution

```bash
# Run all tests
npm test

# Run in watch mode during development
npm run test:watch

# Run E2E tests
npm run e2e
```

## Success Metrics

You'll know testing is sufficient when:
- ✅ Can refactor any tab component internals without changing tests
- ✅ Timing capture logic changes are immediately caught
- ✅ Magic slashes regressions are detected before E2E
- ✅ File upload issues fail fast in unit tests
- ✅ Can upgrade dependencies with confidence

## Implementation Estimate

- **Phase 1** (Critical path): ~8-10 hours
  - Test utilities: 1 hour
  - LyricEditor: 2-3 hours
  - SongTimingTab: 3-4 hours
  - Integration testing: 2 hours

- **Phase 2** (Workflows): ~10-12 hours
  - SongInfoTab: 2-3 hours
  - TimingAdjustmentTab: 2 hours
  - SubmitTab: 2-3 hours
  - Edge cases & polish: 4 hours

**Total: 20-25 hours** for comprehensive coverage of critical user workflows

## Next Steps

1. Create `frontend/test-utils/index.ts` with shared utilities
2. Implement LyricEditor.spec.ts (highest risk component)
3. Implement SongTimingTab.spec.ts (core workflow)
4. Run tests and iterate until all pass
5. Implement Phase 2 components
6. Add integration tests between tab components
7. Document testing patterns for future contributors

## References

- Existing test examples: `frontend/stores/timings.spec.ts` (well-structured)
- E2E tests: `tests/e2e/*.spec.ts` (for workflow understanding)
- Testing library: [Vitest](https://vitest.dev/)
- Component testing: [@vue/test-utils](https://test-utils.vuejs.org/)
