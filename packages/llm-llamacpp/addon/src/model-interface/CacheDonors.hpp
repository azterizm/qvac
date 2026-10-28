#pragma once

#include <optional>
#include <string>
#include <vector>

#include <llama.h>

#include "CacheFileIndex.hpp"
#include "CacheSourceSelection.hpp"
#include "SlotStateCache.hpp"
#include "SpeculativeRuntime.hpp"

// The `cache::DonorState`s a provider hands out, one per place a
// conversation can be kept. Each copies the state into the requesting
// sequence and leaves the original as it was.
namespace qvac_lib_inference_addon_llama::cache {

// A conversation parked in another sequence of the same context: the cells
// are shared with, or copied to, the requesting sequence, as llama-server's
// `server_slot::copy_state_to` does.
inline DonorState sequenceDonor(
    llama_seq_id source, const std::vector<llama_token>& ledgerWords,
    const Checkpoints& checkpoints) {
  return DonorState{
      .copyInto =
          [source](llama_context* lctx, llama_seq_id seqId) {
            llama_memory_t mem = llama_get_memory(lctx);
            if (mem == nullptr || source == seqId) {
              return false;
            }
            llama_memory_seq_rm(mem, seqId, -1, -1);
            llama_memory_seq_cp(mem, source, seqId, -1, -1);
            speculative::resetDraftSequence(lctx, seqId);
            return true;
          },
      .ledgerWords = &ledgerWords,
      .checkpoints = &checkpoints,
      .source = "sequence " + std::to_string(source)};
}

// A RAM-tier entry: its bytes are restored into the requesting sequence and
// stay in the tier.
inline DonorState ramTierDonor(const batching::SlotStateCacheEntry& entry) {
  return DonorState{
      .copyInto =
          [&entry](llama_context* lctx, llama_seq_id seqId) {
            if (llama_state_seq_set_data_ext(
                    lctx, entry.state.data(), entry.state.size(), seqId, 0) ==
                0) {
              return false;
            }
            speculative::restoreDraftSequenceState(lctx, seqId, entry.draft, 0);
            return true;
          },
      .ledgerWords = &entry.ledgerWords,
      .checkpoints = &entry.checkpoints,
      .source = "the RAM tier"};
}

// A cacheKey file: loaded into the requesting sequence, which must find the
// ledger the index read from it.
inline DonorState fileDonor(
    const std::string& path, const std::vector<llama_token>& ledgerWords) {
  return DonorState{
      .copyInto =
          [&path, &ledgerWords](llama_context* lctx, llama_seq_id seqId) {
            if (!CacheFileIndex::loadInto(lctx, seqId, path, ledgerWords)) {
              return false;
            }
            // Cache files hold the target state only.
            speculative::resetDraftSequence(lctx, seqId);
            return true;
          },
      .ledgerWords = &ledgerWords,
      .checkpoints = nullptr,
      .source = "'" + path + "'"};
}

// Hands `adopt` the RAM-tier entry or the cacheKey file other than
// `excludedFile` that serves the most of `prompt`, when it serves more than
// `minimum`; the RAM tier wins a tie, being cheaper to copy from. Either may
// be null. Returns what `adopt` returned, or false when nothing qualified.
inline bool offerStoredState(
    batching::SlotStateCache* ramTier, CacheFileIndex* files,
    const std::string& excludedFile, const Ledger& prompt, bool trimmable,
    size_t minimum, const DonorAdopter& adopt) {
  std::optional<CacheFileIndex::Match> inFile;
  if (files != nullptr) {
    inFile = files->longestPrefix(prompt, trimmable, excludedFile);
  }
  const size_t fileServes = inFile.has_value() ? inFile->reusable : 0;
  // The tier takes an entry serving more than the minimum it is given.
  const size_t ramMinimum = fileServes > minimum ? fileServes - 1 : minimum;
  if (ramTier != nullptr &&
      ramTier->useLongestPrefix(
          prompt,
          trimmable,
          ramMinimum,
          [&adopt](const batching::SlotStateCacheEntry& entry) {
            return adopt(ramTierDonor(entry));
          })) {
    return true;
  }
  return fileServes > minimum && adopt(fileDonor(inFile->path, inFile->words));
}

} // namespace qvac_lib_inference_addon_llama::cache
