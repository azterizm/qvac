#pragma once
#include <cstddef>
#include <string_view>

namespace qvac_lib_inference_addon_llama::utils {

/// Deepest array/object nesting accepted in request JSON. picojson and
/// fabric's `json_schema_to_grammar` and chat templates recurse once per
/// nesting level; on a 512 KB thread stack, the default for worker threads on
/// macOS and iOS, fabric overflows past 512 levels. fabric also recurses once
/// per `$ref` link, which this limit does not bound.
inline constexpr size_t K_MAX_JSON_DEPTH = 128;

/// Whether arrays and objects in @p json nest deeper than K_MAX_JSON_DEPTH.
/// Brackets inside strings are skipped.
inline bool nestsTooDeep(std::string_view json) {
  size_t depth = 0;
  bool inString = false;
  bool escaped = false;
  for (const char c : json) {
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (c == '\\') {
        escaped = true;
      } else if (c == '"') {
        inString = false;
      }
    } else if (c == '"') {
      inString = true;
    } else if (c == '[' || c == '{') {
      if (++depth > K_MAX_JSON_DEPTH) {
        return true;
      }
    } else if ((c == ']' || c == '}') && depth > 0) {
      --depth;
    }
  }
  return false;
}

} // namespace qvac_lib_inference_addon_llama::utils
