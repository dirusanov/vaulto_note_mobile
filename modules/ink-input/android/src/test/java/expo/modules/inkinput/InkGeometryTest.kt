package expo.modules.inkinput

import java.io.File
import kotlin.math.abs
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * The port must make the same strokes as src/drawing/ink.ts: the cases and
 * their expected results are written by tests/inkNativeFixtures.cjs.
 */
class InkGeometryTest {
  private fun fixture(): List<String> {
    val file = generateSequence(File("").absoluteFile) { it.parentFile }
      .map { File(it, "tests/fixtures/inkNative.txt") }
      .firstOrNull { it.exists() }
      ?: error("tests/fixtures/inkNative.txt missing: run `npm run test:ink-native`")
    return file.readLines()
  }

  private fun numbers(line: String): DoubleList {
    val list = DoubleList()
    if (line.isNotBlank()) {
      line.split(' ').forEach { list.add(it.toDouble()) }
    }
    return list
  }

  private fun assertSame(expected: DoubleList, actual: DoubleList, what: String) {
    assertEquals("$what: length", expected.size, actual.size)
    for (i in 0 until expected.size) {
      assertTrue("$what: value $i is ${actual[i]}, expected ${expected[i]}", abs(expected[i] - actual[i]) < 1e-6)
    }
  }

  @Test
  fun matchesTheCanvas() {
    val lines = fixture()
    var outlines = 0
    var shapes = 0
    for (c in 0 until lines.size / 3) {
      val header = lines[c * 3].split(' ')
      val input = numbers(lines[c * 3 + 1])
      val expected = lines[c * 3 + 2]
      when (header[0]) {
        "outline" -> {
          val spec = InkSpec(header[3].toDouble(), header[4].toDouble(), header[5].toBoolean(), header[6].toDouble())
          val actual = strokeOutline(input, header[2].toDouble(), spec, header[7].toBoolean())
          assertSame(numbers(expected), actual, "case $c (${header[1]}, ${input.size / 3} samples)")
          outlines++
        }
        "shape" -> {
          val actual = recognizeShape(input)
          if (expected == "null") {
            assertNull("case $c: no shape expected", actual)
          } else {
            assertSame(numbers(expected), actual ?: DoubleList(), "case $c (shape)")
          }
          shapes++
        }
      }
    }
    assertTrue(outlines > 0 && shapes > 0)
  }

  /** The live stroke, built up piece by piece as it is drawn, is the committed outline. */
  @Test
  fun liveTraceIsTheFinishedOutline() {
    val lines = fixture()
    for (c in 0 until lines.size / 3) {
      val header = lines[c * 3].split(' ')
      if (header[0] != "outline" || header[7].toBoolean()) {
        continue
      }
      val input = numbers(lines[c * 3 + 1])
      val spec = InkSpec(header[3].toDouble(), header[4].toDouble(), header[5].toBoolean(), header[6].toDouble())
      val trace = InkTrace(header[2].toDouble(), spec.thinning, spec.streamline, spec.taper, spec.nib)
      val growing = DoubleList()
      for (i in 0 until input.size) {
        growing.add(input[i])
        if (growing.size % 3 == 0) {
          trace.append(growing)
        }
      }
      val tail = trace.tail(growing)
      val whole = trace.outline(tail, 0, tail.n - 1, true, true)
      assertSame(numbers(lines[c * 3 + 2]), whole, "case $c (incremental)")
    }
  }
}
